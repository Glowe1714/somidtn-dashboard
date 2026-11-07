"""Build the public SoMidTN Dashboard site from the Claude dashboard's files.

Inputs (downloaded from the Claude artifact by the publishing task):
  --docs   folder holding datasets/<id>.json  (ArtifactData list of collection "datasets")
  --pages  folder holding files/<name>.json   (ArtifactData list of collection "files": index.html, app.js, style.css, export.js)
  --assets folder holding <blob id>.json      (the data files the file datasets point to)
  --out    the repository folder to write (index.html, app.js, style.css, data/)
Modes:
  --plan   only print the blob ids that must be downloaded (new or changed since data/manifest.json)
FRED datasets are fetched from FRED's public CSV download (no key needed). If FRED fails for a series,
the previous copy in data/ is kept and the manifest marks it. The build stops (exit 1) if any file dataset
has neither a fresh download nor a previous copy, or if a page file is missing.
"""
import argparse, csv, datetime, glob, io, json, os, re, subprocess, sys, time

p = argparse.ArgumentParser()
p.add_argument('--docs', required=True); p.add_argument('--out', required=True)
p.add_argument('--pages'); p.add_argument('--assets'); p.add_argument('--plan', action='store_true')
a = p.parse_args()

docs = {}
for f in sorted(glob.glob(os.path.join(a.docs, 'datasets', '*.json'))):
    docs[os.path.basename(f)[:-5]] = json.load(open(f))
if len(docs) < 40:
    sys.exit('Only %d dataset documents found in %s; expected about 72.' % (len(docs), a.docs))
data_dir = os.path.join(a.out, 'data')
os.makedirs(data_dir, exist_ok=True)
man_path = os.path.join(data_dir, 'manifest.json')
prev = {d['id']: d for d in json.load(open(man_path))['datasets']} if os.path.exists(man_path) else {}

def blob(d):
    return d['source']['url'].rstrip('/').split('/')[-1]

if a.plan:
    need = [blob(d) for i, d in docs.items() if d.get('source', {}).get('kind') == 'file'
            and (prev.get(i, {}).get('source_blob') != blob(d) or not os.path.exists(os.path.join(data_dir, i + '.json')))]
    # The employer Sheet is published filtered (see below), so its full copy is needed on every build.
    if 'employers' in docs and docs['employers'].get('source', {}).get('kind') == 'file' and blob(docs['employers']) not in need:
        need.append(blob(docs['employers']))
    print('\n'.join(need))
    sys.exit(0)

def fred_rows(series, limit, units):
    url = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + series
    for attempt in range(3):
        r = subprocess.run(['curl', '-sS', '-f', '-m', '60', url], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.startswith('observation_date'):
            break
        time.sleep(3 * (attempt + 1))
    else:
        raise RuntimeError('FRED download failed for %s: %s' % (series, r.stderr.strip()[:160]))
    rows = []
    for row in list(csv.reader(io.StringIO(r.stdout)))[1:]:
        if len(row) < 2: continue
        v = row[1].strip()
        rows.append({'date': row[0][:10], 'value': None if v in ('', '.') else float(v)})
    if units == 'pc1':  # percent change from a year ago (monthly series), same formula as FRED
        by = {x['date']: x['value'] for x in rows}
        out = []
        for x in rows:
            y, m = int(x['date'][:4]), x['date'][5:]
            base = by.get('%d-%s' % (y - 1, m))
            out.append({'date': x['date'], 'value': None if x['value'] is None or not base else round((x['value'] / base - 1) * 100, 5)})
        rows = [x for x in out if x['date'] >= rows[12]['date']] if len(rows) > 12 else []
    elif units:
        raise RuntimeError('Unsupported units transformation %s for %s' % (units, series))
    rows = rows[-int(limit):] if limit else rows
    return list(reversed(rows))  # newest first, like the FRED API the dashboard uses

now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
manifest, problems, kept = [], [], []
for i, d in sorted(docs.items()):
    s = d.get('source', {})
    m = {'id': i, 'title': d.get('title'), 'description': d.get('description'), 'kind': None,
         'updated_at': (d.get('updated') or {}).get('at') or (d.get('edit') or {}).get('at'),
         'updated_by': (d.get('updated') or {}).get('by'), 'stale_after_hours': d.get('staleAfterHours')}
    target = os.path.join(data_dir, i + '.json')
    if s.get('kind') == 'file':
        m['kind'] = 'file'; m['source_blob'] = blob(d)
        src = os.path.join(a.assets or '', blob(d) + '.json')
        if a.assets and os.path.exists(src):
            rows = json.load(open(src))
            if not isinstance(rows, list): problems.append(i + ': file is not a JSON array'); continue
            json.dump(rows, open(target, 'w'), ensure_ascii=False, separators=(',', ':'))
        elif prev.get(i, {}).get('source_blob') == blob(d) and os.path.exists(target):
            pass  # unchanged since the last build
        else:
            problems.append(i + ': data file %s was not downloaded' % blob(d)); continue
        m['fetched_at'] = now if a.assets and os.path.exists(src) else prev.get(i, {}).get('fetched_at')
    elif s.get('kind') == 'query' and s.get('connector') == 'FRED':
        args = s.get('args', {})
        m.update(kind='fred', series_id=args.get('series_id'))
        try:
            rows = fred_rows(args['series_id'], args.get('limit'), args.get('units_transformation'))
            if not rows: raise RuntimeError('no observations for ' + args['series_id'])
            json.dump(rows, open(target, 'w'), separators=(',', ':'))
            m['fetched_at'] = now; m['updated_at'] = now; m['updated_by'] = 'FRED public download'
        except Exception as e:
            if os.path.exists(target):
                kept.append('%s (%s)' % (i, e)); m['fetched_at'] = prev.get(i, {}).get('fetched_at'); m['note'] = 'kept previous copy: ' + str(e)[:120]
            else:
                problems.append('%s: %s' % (i, e)); continue
        time.sleep(0.3)
    else:
        continue
    manifest.append(m)

if a.pages:
    # Page files: index.html, app.js and style.css are required; other plain .js/.css files (such as export.js)
    # are copied too. Files the public site owns itself (runtime.js, theme.css) are never overwritten.
    names = sorted(os.path.basename(f)[:-5] for f in glob.glob(os.path.join(a.pages, 'files', '*.json')))
    for name in ('index.html', 'app.js', 'style.css'):
        if name not in names: problems.append('page file missing: ' + name)
    for name in names:
        if name in ('runtime.js', 'theme.css') or (name != 'index.html' and not re.match(r'^[A-Za-z0-9_-]+\.(js|css)$', name)):
            problems.append('unexpected page file name: ' + name); continue
        text = json.load(open(os.path.join(a.pages, 'files', name + '.json')))['text']
        if name == 'index.html':
            body = text.replace('<meta name="dash-one-writer">', '').replace('<link rel="stylesheet" href="style.css">', '')
            scripts = re.findall(r'<script src="([^"]+)"></script>', body)
            body = re.sub(r'<script src="[^"]+"></script>\s*', '', body).strip()
            for src in scripts:
                if src not in names: problems.append('index.html loads %s but there is no page file by that name' % src)
            extra = ''.join('<script src="%s"></script>\n' % src for src in scripts if src != 'app.js')
            shell = open(os.path.join(a.out, 'tools', 'shell.html')).read()
            text = shell.replace('<!--BODY-->', body).replace('<script src="app.js"></script>\n', '<script src="app.js"></script>\n' + extra)
        open(os.path.join(a.out, name), 'w').write(text)

# Publish only the employer rows the dashboard would show: in the 13 counties, not repeated, and with a web
# source (a link in Greg's Sheet, or a source found by a monthly web check). Unsourced research rows stay private.
emp_path, chk_path = os.path.join(data_dir, 'employers.json'), os.path.join(data_dir, 'employer_checks.json')
if os.path.exists(emp_path) and 'employers' in docs:
    src = os.path.join(a.assets or '', blob(docs['employers']) + '.json')
    if not (a.assets and os.path.exists(src)):
        problems.append('employers: the full Sheet copy %s was not downloaded' % blob(docs['employers']))
    else:
        checks = json.load(open(chk_path)) if os.path.exists(chk_path) else []
        ok_checks = {(str(c.get('county')).lower(), str(c.get('company')).lower().strip()) for c in checks
                     if c.get('status') in ('confirmed', 'changed', 'closed') and c.get('source_url')}
        rows = [e for e in json.load(open(src)) if e.get('in_region') and not e.get('duplicate')
                and (e.get('has_url') or (str(e.get('county')).lower(), str(e.get('company')).lower().strip()) in ok_checks)]
        json.dump(rows, open(emp_path, 'w'), ensure_ascii=False, separators=(',', ':'))

if problems:
    print('BUILD FAILED:'); print('\n'.join('  - ' + x for x in problems)); sys.exit(1)
json.dump({'generated_at': now, 'artifact': 'https://claude.ai/artifact/1yMiEiZHEbm1kT9HW8fcMC', 'datasets': manifest},
          open(man_path, 'w'), indent=1, ensure_ascii=False)
print('built %d datasets (%d files, %d FRED) at %s' % (len(manifest), sum(1 for x in manifest if x['kind'] == 'file'), sum(1 for x in manifest if x['kind'] == 'fred'), now))
if kept: print('kept previous copies for: ' + '; '.join(kept))
