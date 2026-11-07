/* SoMidTN Dashboard — loaders, calculations, drawings and controls. */
(() => {
  const COUNTIES = ['Bedford', 'Coffee', 'Franklin', 'Giles', 'Hickman', 'Lawrence', 'Lewis', 'Lincoln', 'Marshall', 'Maury', 'Moore', 'Perry', 'Wayne'];
  const ids = (p) => COUNTIES.map((c) => p + '_' + c.toLowerCase());
  // Live FRED queries are kept small per tab so FRED's speed limit is never hit; county data comes from files the morning task refreshes.
  const SYNC_IDS = ['tn_urn', 'us_urn', 'tn_mfg', 'tn_leih', 'tn_nonfarm', 'tn_claims', 'mortgage30', 'ust10', 'fed_upper', 'cpi_yoy', 'tn_mfg_wage', 'nash_mfg', 'us_mfg'];
  // Markets & macro tab: loaded only when that tab is opened.
  const MK_IDS = ['mk_dgs2', 'mk_dgs10', 'mk_dgs30', 'mk_ig', 'mk_hy', 'mk_receipts', 'mk_outlays', 'mk_deficit', 'mk_debt'];
  const FRED_IDS = [...ids('pop'), ...ids('bp'), ...SYNC_IDS, ...MK_IDS];

  /* ---------- loader: FRED observations -> {date, value} rows ---------- */
  const fredLoader = ({ answer }) => {
    let a = answer;
    if (a && typeof a === 'object' && Array.isArray(a.content)) a = a.content.map((c) => (c && c.text) || '').join('');
    if (typeof a === 'string') {
      try { a = JSON.parse(a); } catch (e) { throw new Error(a.slice(0, 300)); }
    }
    if (!a || !Array.isArray(a.observations)) throw new Error(String((a && (a.error || a.message)) || 'FRED returned no observations'));
    const rows = a.observations.map((o) => ({
      date: String(o[0]).slice(0, 10),
      value: o[1] === '.' || o[1] === '' || o[1] == null ? null : Number(o[1]),
    }));
    return {
      data: rows,
      columns: ['date', 'value'],
      meta: [
        { label: 'FRED series', value: String(a.series_id || '') },
        { label: 'Title', value: String(a.title || '') },
        { label: 'Units', value: String(a.raw_series_units || '') + (a.units_transformation ? ' (' + a.units_transformation + ')' : '') },
        { label: 'Seasonal adjustment', value: String(a.seasonal_adjustment || '') },
        { label: 'FRED last updated', value: String(a.last_updated || '') },
      ],
    };
  };
  for (const id of FRED_IDS) dash.loader(id, { description: 'FRED observations as date/value rows; a “.” (no value) becomes empty.', fn: fredLoader });

  /* ---------- calculations ---------- */
  dash.calc('labor_latest', {
    title: 'County unemployment & labor force',
    description: 'Latest month and the same month a year earlier for each county and Tennessee (BLS LAUS, not seasonally adjusted).',
    inputs: ['laus_county'],
    fn: (laus_county) => {
      const places = ['Bedford', 'Coffee', 'Franklin', 'Giles', 'Hickman', 'Lawrence', 'Lewis', 'Lincoln', 'Marshall', 'Maury', 'Moore', 'Perry', 'Wayne', 'Tennessee'];
      const mon = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
      const ago = (d) => (Number(d.slice(0, 4)) - 1) + d.slice(4);
      const r1 = (x) => Math.round(x * 10) / 10;
      return places.map((county) => {
        const rows = laus_county.filter((r) => r.county === county && r.rate != null).sort((a, b) => (a.date < b.date ? 1 : -1));
        const cur = rows[0];
        if (!cur) return { county, date: null, month: null, rate: null, rate_ya: null, rate_chg: null, lf: null, lf_ya: null, lf_chg_pct: null, month_ya: null };
        const ya = rows.find((r) => r.date === ago(cur.date));
        return {
          county, date: cur.date, month: mon(cur.date), rate: cur.rate,
          rate_ya: ya ? ya.rate : null, rate_chg: ya ? r1(cur.rate - ya.rate) : null,
          lf: cur.lf, lf_ya: ya ? ya.lf : null,
          lf_chg_pct: cur.lf != null && ya && ya.lf ? r1((cur.lf / ya.lf - 1) * 100) : null,
          month_ya: ya ? mon(ya.date) : null,
        };
      });
    },
  });

  dash.calc('labor_region', {
    title: 'Region unemployment & labor force',
    description: 'All 13 counties combined; the rate weights each county by its labor force.',
    inputs: ['labor_latest'],
    fn: (labor_latest) => {
      const r1 = (x) => Math.round(x * 10) / 10;
      const ok = labor_latest.filter((r) => r.county !== 'Tennessee' && r.rate != null && r.lf != null);
      const both = ok.filter((r) => r.rate_ya != null && r.lf_ya != null);
      const lf = ok.reduce((s, r) => s + r.lf, 0);
      const un = ok.reduce((s, r) => s + (r.rate * r.lf) / 100, 0);
      const lfYa = both.reduce((s, r) => s + r.lf_ya, 0);
      const unYa = both.reduce((s, r) => s + (r.rate_ya * r.lf_ya) / 100, 0);
      const rate = lf ? r1((un / lf) * 100) : null;
      const rateYa = lfYa ? r1((unYa / lfYa) * 100) : null;
      const hi = ok.slice().sort((a, b) => b.rate - a.rate)[0];
      const lo = ok.slice().sort((a, b) => a.rate - b.rate)[0];
      return [{
        month: ok.length ? ok[0].month : null, month_ya: ok.length ? ok[0].month_ya : null, counties: ok.length,
        rate, rate_ya: rateYa, rate_chg: rate != null && rateYa != null ? r1(rate - rateYa) : null,
        lf, lf_ya: lfYa, lf_chg: lf - lfYa, lf_chg_pct: lfYa ? r1((lf / lfYa - 1) * 100) : null,
        high_county: hi ? hi.county : null, high_rate: hi ? hi.rate : null,
        low_county: lo ? lo.county : null, low_rate: lo ? lo.rate : null,
      }];
    },
  });

  dash.calc('urn_trend', {
    title: 'Unemployment trend by county',
    description: 'Monthly rates for each county, the region (labor-force weighted) and Tennessee, all not seasonally adjusted (BLS LAUS).',
    inputs: ['laus_county'],
    fn: (laus_county) => {
      const counties = ['Bedford', 'Coffee', 'Franklin', 'Giles', 'Hickman', 'Lawrence', 'Lewis', 'Lincoln', 'Marshall', 'Maury', 'Moore', 'Perry', 'Wayne'];
      const out = laus_county.map((r) => ({ date: r.date, series: r.county, rate: r.rate }));
      [...new Set(laus_county.map((r) => r.date))].forEach((d) => {
        const rows = laus_county.filter((r) => r.date === d && counties.includes(r.county) && r.rate != null && r.lf != null);
        const lf = rows.reduce((s, r) => s + r.lf, 0);
        const un = rows.reduce((s, r) => s + (r.rate * r.lf) / 100, 0);
        out.push({ date: d, series: 'Region', rate: rows.length === counties.length ? Math.round((un / lf) * 1000) / 10 : null });
      });
      return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    },
  });

  dash.calc('pop_county', {
    title: 'Population by county',
    description: 'Latest Census estimate (persons) and percent change from the earliest year loaded.',
    inputs: ids('pop'),
    fn: (...series) => {
      const counties = ['Bedford', 'Coffee', 'Franklin', 'Giles', 'Hickman', 'Lawrence', 'Lewis', 'Lincoln', 'Marshall', 'Maury', 'Moore', 'Perry', 'Wayne'];
      const r1 = (x) => Math.round(x * 10) / 10;
      return counties.map((county, i) => {
        const s = series[i].filter((r) => r.value != null).sort((a, b) => (a.date < b.date ? 1 : -1));
        const cur = s[0], prev = s[1], base = s[s.length - 1];
        const p = (r) => (r ? Math.round(r.value * 1000) : null);
        return {
          county, year: cur ? Number(cur.date.slice(0, 4)) : null, pop: p(cur), pop_prev: p(prev),
          base_year: base ? Number(base.date.slice(0, 4)) : null, pop_base: p(base),
          chg_1yr_pct: cur && prev ? r1((cur.value / prev.value - 1) * 100) : null,
          chg_since_base_pct: cur && base ? r1((cur.value / base.value - 1) * 100) : null,
        };
      });
    },
  });

  dash.calc('pop_region', {
    title: 'Region population by year',
    description: 'Sum of the 13 county Census estimates for each year where every county has a value.',
    inputs: ids('pop'),
    fn: (...series) => {
      const years = new Map();
      series.forEach((s) => s.forEach((r) => {
        if (r.value == null) return;
        const y = Number(r.date.slice(0, 4));
        const e = years.get(y) || { n: 0, sum: 0 };
        e.n += 1; e.sum += r.value * 1000; years.set(y, e);
      }));
      const rows = [...years.entries()].filter(([, e]) => e.n === series.length).map(([year, e]) => ({ year, pop: Math.round(e.sum) })).sort((a, b) => b.year - a.year);
      const base = rows[rows.length - 1];
      return rows.map((r) => ({ ...r, base_year: base.year, chg_since_base: r.pop - base.pop, chg_since_base_pct: Math.round((r.pop / base.pop - 1) * 1000) / 10 }));
    },
  });

  dash.calc('income_county', {
    title: 'Income and poverty by county',
    description: 'Median household income and poverty rate (Census SAIPE) and per-capita personal income (BEA), latest year, with Tennessee for comparison.',
    inputs: ['county_annual'],
    fn: (county_annual) => {
      const places = ['Bedford', 'Coffee', 'Franklin', 'Giles', 'Hickman', 'Lawrence', 'Lewis', 'Lincoln', 'Marshall', 'Maury', 'Moore', 'Perry', 'Wayne', 'Tennessee'];
      const latest = (c, m) => county_annual.filter((r) => r.county === c && r.measure === m && r.value != null).sort((a, b) => b.year - a.year);
      return places.map((county) => {
        const m = latest(county, 'mhi'), p = latest(county, 'pcpi'), v = latest(county, 'poverty');
        return {
          county, year: m[0] ? m[0].year : null,
          mhi: m[0] ? m[0].value : null, mhi_prev: m[1] ? m[1].value : null,
          mhi_chg_pct: m[0] && m[1] ? Math.round((m[0].value / m[1].value - 1) * 1000) / 10 : null,
          pcpi: p[0] ? p[0].value : null, pcpi_year: p[0] ? p[0].year : null,
          poverty: v[0] ? v[0].value : null,
        };
      });
    },
  });

  dash.calc('gdp_county', {
    title: 'Real GDP by county',
    description: 'BEA real GDP in billions of 2017 dollars, latest year, with change from the prior year and from the earliest year loaded.',
    inputs: ['county_annual'],
    fn: (county_annual) => {
      const counties = ['Bedford', 'Coffee', 'Franklin', 'Giles', 'Hickman', 'Lawrence', 'Lewis', 'Lincoln', 'Marshall', 'Maury', 'Moore', 'Perry', 'Wayne'];
      const r1 = (x) => Math.round(x * 10) / 10;
      return counties.map((county) => {
        const s = county_annual.filter((r) => r.county === county && r.measure === 'gdp_real_k' && r.value != null).sort((a, b) => b.year - a.year);
        const cur = s[0], prev = s[1], base = s[s.length - 1];
        return {
          county, year: cur ? cur.year : null,
          gdp_b: cur ? Math.round(cur.value / 1000) / 1000 : null,
          base_year: base ? base.year : null,
          chg_1yr_pct: cur && prev ? r1((cur.value / prev.value - 1) * 100) : null,
          chg_since_base_pct: cur && base ? r1((cur.value / base.value - 1) * 100) : null,
        };
      });
    },
  });

  dash.calc('gdp_region', {
    title: 'Region real GDP by year',
    description: 'Sum of the 13 county real GDP figures (billions of 2017 dollars) for each year where every county has a value.',
    inputs: ['county_annual'],
    fn: (county_annual) => {
      const counties = ['Bedford', 'Coffee', 'Franklin', 'Giles', 'Hickman', 'Lawrence', 'Lewis', 'Lincoln', 'Marshall', 'Maury', 'Moore', 'Perry', 'Wayne'];
      const years = new Map();
      county_annual.filter((r) => r.measure === 'gdp_real_k' && counties.includes(r.county) && r.value != null).forEach((r) => {
        const e = years.get(r.year) || { n: 0, sum: 0 };
        e.n += 1; e.sum += r.value; years.set(r.year, e);
      });
      const rows = [...years.entries()].filter(([, e]) => e.n === counties.length).map(([year, e]) => ({ year, gdp_k: e.sum })).sort((a, b) => b.year - a.year);
      const base = rows[rows.length - 1];
      return rows.map((r, i) => ({
        year: r.year, gdp_b: Math.round(r.gdp_k / 100000) / 10, base_year: base.year,
        chg_1yr_pct: rows[i + 1] ? Math.round((r.gdp_k / rows[i + 1].gdp_k - 1) * 1000) / 10 : null,
        chg_since_base_pct: Math.round((r.gdp_k / base.gdp_k - 1) * 1000) / 10,
      }));
    },
  });

  dash.calc('biz_county', {
    title: 'Private establishments by county',
    description: 'BLS QCEW count of private business establishments, latest quarter and the same quarter a year earlier.',
    inputs: ['qcew_mfg'],
    fn: (qcew_mfg) => qcew_mfg.filter((r) => r.county !== 'Tennessee').map((r) => ({
      county: r.county, quarter: r.quarter, est: r.private_estabs ?? null, est_ya: r.private_estabs_ya ?? null,
      est_chg: r.private_estabs != null && r.private_estabs_ya != null ? r.private_estabs - r.private_estabs_ya : null,
    })),
  });

  dash.calc('edu_county', {
    title: "Bachelor's degree or higher by county",
    description: 'Census ACS 5-year estimate, percent of adults 25 and older with a bachelor’s degree or higher.',
    inputs: ['acs_county'],
    fn: (acs_county) => acs_county.filter((r) => r.county !== 'Tennessee').map((r) => ({ county: r.county, year: Number(String(r.period).slice(5, 9)), bach_pct: r.bach_plus_pct })),
  });

  dash.calc('permits', {
    title: 'Housing units permitted by county and year',
    description: 'Census Building Permits Survey, new private housing units authorized, one row per county and year.',
    inputs: ids('bp'),
    fn: (...series) => {
      const counties = ['Bedford', 'Coffee', 'Franklin', 'Giles', 'Hickman', 'Lawrence', 'Lewis', 'Lincoln', 'Marshall', 'Maury', 'Moore', 'Perry', 'Wayne'];
      const out = [];
      counties.forEach((county, i) => series[i].forEach((r) => { if (r.value != null) out.push({ county, year: Number(r.date.slice(0, 4)), units: r.value }); }));
      return out;
    },
  });

  dash.calc('permits_latest', {
    title: 'Housing units permitted, latest year',
    description: 'Each county’s most recent year from the permits table.',
    inputs: ['permits'],
    fn: (permits) => {
      const by = new Map();
      permits.forEach((r) => { const e = by.get(r.county); if (!e || r.year > e.year) by.set(r.county, r); });
      return [...by.values()].map((r) => ({ county: r.county, year: r.year, units: r.units }));
    },
  });

  dash.calc('permits_region', {
    title: 'Region housing units permitted by year',
    description: 'Sum of the 13 counties for each year.',
    inputs: ['permits'],
    fn: (permits) => {
      const by = new Map();
      permits.forEach((r) => by.set(r.year, (by.get(r.year) || 0) + r.units));
      return [...by.entries()].map(([year, units]) => ({ year, units })).sort((a, b) => b.year - a.year);
    },
  });

  dash.calc('mfg_county', {
    title: 'County manufacturing',
    description: 'BLS QCEW private manufacturing jobs (last month of the quarter), change from a year earlier, plants, weekly pay, location quotient and share of private jobs; Region sums the counties BLS reports.',
    inputs: ['qcew_mfg'],
    fn: (qcew_mfg) => {
      const r1 = (x) => Math.round(x * 10) / 10;
      const rows = qcew_mfg.map((r) => ({
        county: r.county, quarter: r.quarter, suppressed: r.suppressed, mfg_jobs: r.mfg_jobs, mfg_jobs_chg: r.mfg_jobs_chg, mfg_jobs_chg_pct: r.mfg_jobs_chg_pct,
        mfg_estabs: r.mfg_estabs, mfg_wage_wk: r.mfg_wage_wk, mfg_lq: r.mfg_lq, private_jobs: r.private_jobs,
        mfg_share_pct: r.mfg_jobs != null && r.private_jobs ? r1((r.mfg_jobs / r.private_jobs) * 100) : null,
      }));
      const c = rows.filter((r) => r.county !== 'Tennessee' && r.mfg_jobs != null);
      const jobs = c.reduce((s, r) => s + r.mfg_jobs, 0);
      const chg = c.filter((r) => r.mfg_jobs_chg != null).reduce((s, r) => s + r.mfg_jobs_chg, 0);
      const priv = c.reduce((s, r) => s + (r.private_jobs || 0), 0);
      rows.push({
        county: 'Region', quarter: c.length ? c[0].quarter : null, suppressed: false, mfg_jobs: jobs, mfg_jobs_chg: chg,
        mfg_jobs_chg_pct: jobs - chg ? r1((chg / (jobs - chg)) * 100) : null, mfg_estabs: c.reduce((s, r) => s + (r.mfg_estabs || 0), 0),
        mfg_wage_wk: null, mfg_lq: null, private_jobs: priv, mfg_share_pct: priv ? r1((jobs / priv) * 100) : null,
      });
      return rows;
    },
  });

  dash.calc('ag_county', {
    title: 'County agriculture',
    description: 'USDA Census of Agriculture: farms, acres, farm product sales (millions of dollars), cattle and top products, with change from the 2017 census; Region sums the 13 counties.',
    inputs: ['ag_census'],
    fn: (ag_census) => {
      const r1 = (x) => Math.round(x * 10) / 10;
      const m = (v) => (v == null ? null : Math.round(v / 100000) / 10);
      const pct = (a, b) => (a != null && b ? r1((a / b - 1) * 100) : null);
      const rows = ag_census.map((r) => ({
        county: r.county, year: r.year, farms: r.farms, farms_2017: r.farms_2017, farms_chg_pct: pct(r.farms, r.farms_2017),
        acres: r.acres, avg_farm_acres: r.avg_farm_acres, sales_m: m(r.sales), sales_chg_pct: pct(r.sales, r.sales_2017),
        crop_m: m(r.crop_sales), animal_m: m(r.animal_sales), cattle_head: r.cattle_head,
        top1: r.top1, top1_m: m(r.top1_sales), top2: r.top2, top2_m: m(r.top2_sales), top3: r.top3, top3_m: m(r.top3_sales), withheld: r.withheld,
      }));
      const c = ag_census.filter((r) => r.county !== 'Tennessee');
      const sum = (f) => c.reduce((s, r) => s + (r[f] || 0), 0);
      rows.push({
        county: 'Region', year: c.length ? c[0].year : null, farms: sum('farms'), farms_2017: sum('farms_2017'), farms_chg_pct: pct(sum('farms'), sum('farms_2017')),
        acres: sum('acres'), avg_farm_acres: null, sales_m: m(sum('sales')), sales_chg_pct: pct(sum('sales'), sum('sales_2017')),
        crop_m: m(sum('crop_sales')), animal_m: m(sum('animal_sales')), cattle_head: sum('cattle_head'),
        top1: null, top1_m: null, top2: null, top2_m: null, top3: null, top3_m: null, withheld: null,
      });
      return rows;
    },
  });

  dash.calc('ag_latest', {
    title: 'Latest USDA county estimates',
    description: 'USDA NASS annual survey estimates for each county: cattle and calves on January 1 (this year and last), beef cows, crop production and average cash rent; Region adds the 13 counties for cattle.',
    inputs: ['ag_survey'],
    fn: (ag_survey) => {
      const rows = ag_survey.map((r) => ({ ...r }));
      const c = ag_survey.filter((r) => r.county !== 'Tennessee');
      const all = (f) => c.every((r) => r[f] != null);
      const sum = (f) => c.reduce((s, r) => s + (r[f] || 0), 0);
      const cur = all('cattle_head') ? sum('cattle_head') : null, prev = all('cattle_head_prev') ? sum('cattle_head_prev') : null;
      rows.push({ county: 'Region', cattle_as_of: c.length ? c[0].cattle_as_of : null, cattle_head: cur, cattle_head_prev: prev,
        cattle_chg_pct: cur != null && prev ? Math.round((cur / prev - 1) * 1000) / 10 : null, crops_year: c.length ? c[0].crops_year : null, rent_year: c.length ? c[0].rent_year : null });
      return rows;
    },
  });

  dash.calc('industry_mix', {
    title: 'Economy mix by county',
    description: 'BEA GDP by industry for the latest year, grouped into eight sectors with each sector\'s share of the county total; "Not disclosed" is the total minus the published industries.',
    inputs: ['bea_gdp_industry'],
    fn: (bea_gdp_industry) => {
      const groups = { 'Manufacturing': 'Manufacturing', 'Finance, insurance & real estate': 'Finance & real estate', 'Government': 'Government',
        'Wholesale trade': 'Trade, transport & utilities', 'Retail trade': 'Trade, transport & utilities', 'Transportation & warehousing': 'Trade, transport & utilities', 'Utilities': 'Trade, transport & utilities',
        'Education & health care': 'Health, education & hospitality', 'Arts, lodging & food service': 'Health, education & hospitality',
        'Information': 'Business & other services', 'Professional & business services': 'Business & other services', 'Other services': 'Business & other services',
        'Construction': 'Construction, farming & mining', 'Agriculture & forestry': 'Construction, farming & mining', 'Mining': 'Construction, farming & mining' };
      const order = ['Manufacturing', 'Finance & real estate', 'Trade, transport & utilities', 'Health, education & hospitality', 'Business & other services', 'Construction, farming & mining', 'Government', 'Not disclosed'];
      const year = Math.max(...bea_gdp_industry.map((r) => r.year));
      const rows = bea_gdp_industry.filter((r) => r.year === year);
      const out = [];
      [...new Set(rows.map((r) => r.county))].forEach((county) => {
        const cr = rows.filter((r) => r.county === county);
        const total = (cr.find((r) => r.line === 1) || {}).gdp_k;
        if (!total) return;
        const sums = {};
        cr.filter((r) => r.line !== 1 && r.gdp_k != null).forEach((r) => { const g = groups[r.industry]; sums[g] = (sums[g] || 0) + r.gdp_k; });
        const known = Object.values(sums).reduce((a, b) => a + b, 0);
        sums['Not disclosed'] = Math.max(0, total - known);
        order.forEach((g, i) => out.push({ county, year, group: g, order: i, gdp_m: Math.round((sums[g] || 0) / 100) / 10, share_pct: Math.round(((sums[g] || 0) / total) * 1000) / 10 }));
        cr.filter((r) => r.line !== 1).forEach((r) => out.push({ county, year, group: 'industry:' + r.industry, order: 99, gdp_m: r.gdp_k == null ? null : Math.round(r.gdp_k / 100) / 10, share_pct: r.gdp_k == null ? null : Math.round((r.gdp_k / total) * 1000) / 10 }));
      });
      return out;
    },
  });

  dash.calc('mfg_gdp', {
    title: 'Manufacturing share of GDP',
    description: 'BEA manufacturing GDP as a share of all-industry GDP for the latest year, and the change in manufacturing GDP (current dollars) from the earliest year loaded.',
    inputs: ['bea_gdp_industry'],
    fn: (bea_gdp_industry) => {
      const years = bea_gdp_industry.map((r) => r.year);
      const y1 = Math.max(...years), y0 = Math.min(...years);
      const get = (c, line, y) => (bea_gdp_industry.find((r) => r.county === c && r.line === line && r.year === y) || {});
      return [...new Set(bea_gdp_industry.map((r) => r.county))].map((county) => {
        const m1 = get(county, 12, y1), t1 = get(county, 1, y1), m0 = get(county, 12, y0);
        return {
          county, year: y1, base_year: y0, withheld: !!m1.withheld,
          mfg_gdp_m: m1.gdp_k == null ? null : Math.round(m1.gdp_k / 100) / 10,
          mfg_share_pct: m1.gdp_k == null || !t1.gdp_k ? null : Math.round((m1.gdp_k / t1.gdp_k) * 1000) / 10,
          mfg_chg_pct: m1.gdp_k == null || !m0.gdp_k ? null : Math.round((m1.gdp_k / m0.gdp_k - 1) * 1000) / 10,
        };
      });
    },
  });

  dash.calc('college_summary', {
    title: 'College and TCAT summary',
    description: 'For each school and all 7 combined: latest fall enrollment and the year before, and credentials awarded in the latest school year by level (IPEDS).',
    inputs: ['edu_colleges'],
    fn: (edu_colleges) => {
      const ey = Math.max(...edu_colleges.filter((r) => r.kind === 'enrollment').map((r) => r.year));
      const cy = Math.max(...edu_colleges.filter((r) => r.kind === 'completions').map((r) => r.year));
      const names = [...new Set(edu_colleges.map((r) => r.institution))];
      const sum = (rows) => rows.reduce((s, r) => s + (r.value || 0), 0);
      const one = (name) => {
        const mine = name === 'All' ? edu_colleges : edu_colleges.filter((r) => r.institution === name);
        const en = sum(mine.filter((r) => r.kind === 'enrollment' && r.year === ey));
        const en0 = sum(mine.filter((r) => r.kind === 'enrollment' && r.year === ey - 1));
        const c = mine.filter((r) => r.kind === 'completions' && r.year === cy && r.cip2 === 99);
        const lv = (l) => sum(c.filter((r) => r.level === l));
        const first = mine[0] || {};
        return {
          institution: name, type: name === 'All' ? null : first.type, city: name === 'All' ? null : first.city, county: name === 'All' ? null : first.county,
          enroll_year: ey, enroll: en, enroll_prev: en0, enroll_chg: en - en0, comp_year: cy, comp_label: cy + '–' + String(cy + 1).slice(2),
          certificates: lv('Certificate or diploma'), associate: lv('Associate degree'), bachelor: lv("Bachelor's degree"), graduate: lv('Graduate degree or certificate'),
          bachelor_plus: lv("Bachelor's degree") + lv('Graduate degree or certificate'), total_awards: sum(c),
        };
      };
      return [one('All'), ...names.map(one)];
    },
  });

  dash.calc('program_pipeline', {
    title: 'Regional talent pipeline by program area',
    description: 'Certificates, diplomas and associate degrees awarded in the latest school year by all 7 schools combined, by 2-digit program family (CIP).',
    inputs: ['edu_colleges'],
    fn: (edu_colleges) => {
      const cy = Math.max(...edu_colleges.filter((r) => r.kind === 'completions').map((r) => r.year));
      const by = new Map();
      edu_colleges.filter((r) => r.kind === 'completions' && r.year === cy && r.cip2 !== 99 && (r.level === 'Certificate or diploma' || r.level === 'Associate degree')).forEach((r) => {
        const e = by.get(r.program) || { program: r.program, certificates: 0, associate: 0, schools: new Set() };
        if (r.level === 'Associate degree') e.associate += r.value; else e.certificates += r.value;
        if (r.value > 0) e.schools.add(r.institution);
        by.set(r.program, e);
      });
      return [...by.values()].map((e) => ({ program: e.program, total: e.certificates + e.associate, certificates: e.certificates, associate: e.associate, schools: [...e.schools].join(', '), year: cy }))
        .filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
    },
  });

  dash.calc('grad_summary', {
    title: 'High school graduation by district',
    description: 'One row per school district in the 13 counties (All Students), plus the region (districts added together) and all Tennessee districts (added together from the same file). Rates in percent; state and federal versions as published by TDOE.',
    inputs: ['grad_rates'],
    fn: (grad_rates) => {
      const r1 = (x) => Math.round(x * 10) / 10;
      const all = grad_rates.filter((r) => r.group === 'All Students' && !r.calculated);
      const grp = (sys, g) => grad_rates.find((r) => r.system === sys && r.group === g) || {};
      const label = (r) => (/County$/.test(r.district) ? r.district : r.district + ' (city)');
      const pool = (rows) => {
        const ok = rows.filter((r) => r.grads_state != null && r.grads_federal != null && r.cohort);
        const c = ok.reduce((s, r) => s + r.cohort, 0);
        return { cohort: c, gs: ok.reduce((s, r) => s + r.grads_state, 0), gf: ok.reduce((s, r) => s + r.grads_federal, 0) };
      };
      const year = all.length ? all[0].year : null;
      const rows = all.map((r) => {
        const ed = grp(r.system, 'Economically Disadvantaged'), sw = grp(r.system, 'Students with Disabilities');
        return { district: label(r), county: r.county, year, cohort: r.cohort, grads_state: r.grads_state, rate_state: r.rate_state, rate_federal: r.rate_federal,
          econ_rate_state: ed.rate_state ?? null, econ_note: ed.note ?? null, swd_rate_state: sw.rate_state ?? null, swd_note: sw.note ?? null, note: r.note, calculated: false };
      });
      const p = pool(all), pe = pool(grad_rates.filter((r) => r.group === 'Economically Disadvantaged' && !r.calculated));
      const tn = grad_rates.find((r) => r.calculated) || {};
      return [
        { district: 'Region', county: null, year, cohort: p.cohort, grads_state: p.gs, rate_state: p.cohort ? r1((100 * p.gs) / p.cohort) : null, rate_federal: p.cohort ? r1((100 * p.gf) / p.cohort) : null,
          econ_rate_state: pe.cohort ? r1((100 * pe.gs) / pe.cohort) : null, econ_note: null, swd_rate_state: null, swd_note: null, note: 'Calculated: the districts with published counts added together.', calculated: true },
        { district: 'Tennessee', county: null, year, cohort: tn.cohort ?? null, grads_state: tn.grads_state ?? null, rate_state: tn.rate_state ?? null, rate_federal: tn.rate_federal ?? null,
          econ_rate_state: null, econ_note: null, swd_rate_state: null, swd_note: null, note: tn.note ?? null, calculated: true },
        ...rows,
      ];
    },
  });

  dash.calc('tourism_summary', {
    title: 'Tourism by county',
    description: 'One row per county plus the region (13 counties added together) and Tennessee (all 95 county pages added together): latest-year direct visitor spending, jobs, labor income and state/local taxes, with the prior year for comparison and the state ranking.',
    inputs: ['tourism_county'],
    fn: (tourism_county) => {
      const r1 = (x) => Math.round(x * 10) / 10;
      const places = [...new Set(tourism_county.map((r) => r.county))];
      const one = (c) => {
        const m = (k) => tourism_county.find((r) => r.county === c && r.measure === k) || {};
        const sp = m('spending');
        return {
          county: c, year: sp.year ?? null, prior_year: sp.prior_year ?? null, base_year: sp.base_year ?? null,
          spending: sp.value ?? null, spending_24: sp.prior ?? null, spend_chg_pct: sp.pct_1y ?? null, spend_chg_2018: sp.pct_base ?? null,
          rank: sp.rank ?? null, rank_change: sp.rank_change ?? null,
          jobs: m('employment').value ?? null, jobs_24: m('employment').prior ?? null, labor_income: m('labor_income').value ?? null,
          state_taxes: m('state_taxes').value ?? null, local_taxes: m('local_taxes').value ?? null,
          taxes: (m('state_taxes').value ?? 0) + (m('local_taxes').value ?? 0), tax_hh: m('tax_savings_hh').value ?? null,
          lodging: m('lodging').value ?? null, food_bev: m('food_bev').value ?? null, retail: m('retail').value ?? null,
          recreation: m('recreation').value ?? null, transportation: m('transportation').value ?? null,
        };
      };
      const rows = places.map(one);
      const cty = rows.filter((r) => r.county !== 'Tennessee');
      const tn = rows.find((r) => r.county === 'Tennessee') || {};
      const sum = (k) => cty.reduce((a, r) => a + (r[k] || 0), 0);
      const reg = { county: 'Region', year: tn.year ?? null, prior_year: tn.prior_year ?? null, base_year: tn.base_year ?? null, rank: null, rank_change: null, tax_hh: null, spend_chg_2018: null };
      ['spending', 'spending_24', 'jobs', 'jobs_24', 'labor_income', 'state_taxes', 'local_taxes', 'taxes', 'lodging', 'food_bev', 'retail', 'recreation', 'transportation'].forEach((k) => { reg[k] = sum(k); });
      reg.spend_chg_pct = reg.spending_24 ? r1((reg.spending / reg.spending_24 - 1) * 100) : null;
      reg.jobs_chg = reg.jobs - reg.jobs_24;
      reg.share_tn_pct = tn.spending ? r1((100 * reg.spending) / tn.spending) : null;
      const top = cty.slice().sort((a, b) => b.spending - a.spending)[0] || {};
      reg.top_county = top.county || null; reg.top_rank = top.rank ?? null;
      return [reg, ...rows.map((r) => ({ ...r, jobs_chg: r.jobs != null && r.jobs_24 != null ? r.jobs - r.jobs_24 : null, share_tn_pct: null, top_county: null, top_rank: null }))];
    },
  });

  dash.calc('county_all', {
    title: 'All counties side by side',
    description: 'One row per county joining the labor, population, income, GDP, business, education, permits and tier figures above.',
    inputs: ['labor_latest', 'pop_county', 'income_county', 'gdp_county', 'biz_county', 'edu_county', 'permits_latest', 'counties', 'mfg_county', 'ag_county', 'acs_county'],
    fn: (labor_latest, pop_county, income_county, gdp_county, biz_county, edu_county, permits_latest, counties, mfg_county, ag_county, acs_county) => {
      const get = (rows, c) => rows.find((r) => r.county === c) || {};
      return counties.map((p) => {
        const c = p.county;
        const l = get(labor_latest, c), po = get(pop_county, c), inc = get(income_county, c), g = get(gdp_county, c), b = get(biz_county, c), e = get(edu_county, c), bp = get(permits_latest, c), mf = get(mfg_county, c), ag = get(ag_county, c), ac = get(acs_county, c);
        return {
          county: c, tier: p.tier, rate: l.rate ?? null, lf: l.lf ?? null, pop: po.pop ?? null, pop_chg_pct: po.chg_since_base_pct ?? null,
          mhi: inc.mhi ?? null, poverty: inc.poverty ?? null, pcpi: inc.pcpi ?? null, gdp_b: g.gdp_b ?? null,
          est: b.est ?? null, bach_pct: e.bach_pct ?? null, permits: bp.units ?? null,
          mfg_jobs: mf.mfg_jobs ?? null, mfg_lq: mf.mfg_lq ?? null, farm_sales_m: ag.sales_m ?? null,
          lfpr_pct: ac.lfpr_pct ?? null, median_age: ac.median_age ?? null,
        };
      });
    },
  });

  dash.calc('macro', {
    title: 'Tennessee and U.S. indicators',
    description: 'Latest value of each statewide or national series, with the change from the prior period where shown.',
    inputs: ['tn_urn', 'us_urn', 'tn_nonfarm', 'tn_mfg', 'tn_leih', 'tn_claims', 'mortgage30', 'ust10', 'fed_upper', 'cpi_yoy'],
    fn: (tn_urn, us_urn, tn_nonfarm, tn_mfg, tn_leih, tn_claims, mortgage30, ust10, fed_upper, cpi_yoy) => {
      const L = (s) => s.filter((r) => r.value != null).sort((a, b) => (a.date < b.date ? 1 : -1));
      const ago = (s, d) => s.find((r) => r.date === (Number(d.slice(0, 4)) - 1) + d.slice(4));
      const day = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      const mon = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
      const r1 = (x) => Math.round(x * 10) / 10;
      const yoy = (s) => { const l = L(s); const a = l[0] ? ago(l, l[0].date) : null; return { v: l[0] ? l[0].value : null, chg: l[0] && a ? r1(l[0].value - a.value) : null }; };
      const tu = L(tn_urn), uu = L(us_urn), nf = yoy(tn_nonfarm), mf = yoy(tn_mfg), le = yoy(tn_leih), cl = L(tn_claims), mo = L(mortgage30), t10 = L(ust10), fu = L(fed_upper), cp = L(cpi_yoy);
      return [{
        tn_rate: tu[0] ? tu[0].value : null, us_rate: uu[0] ? uu[0].value : null, month: tu[0] ? mon(tu[0].date) : null,
        nonfarm_k: nf.v, nonfarm_chg_k: nf.chg, mfg_k: mf.v, mfg_chg_k: mf.chg, leih_k: le.v, leih_chg_k: le.chg,
        claims: cl[0] ? cl[0].value : null, claims_prev: cl[1] ? cl[1].value : null, claims_week: cl[0] ? day(cl[0].date) : null,
        mortgage: mo[0] ? mo[0].value : null, mortgage_chg: mo[0] && mo[1] ? Math.round((mo[0].value - mo[1].value) * 100) / 100 : null, mortgage_date: mo[0] ? day(mo[0].date) : null,
        ust10: t10[0] ? t10[0].value : null, ust10_date: t10[0] ? day(t10[0].date) : null,
        fed_upper: fu[0] ? fu[0].value : null, fed_date: fu[0] ? day(fu[0].date) : null,
        cpi: cp[0] ? r1(cp[0].value) : null, cpi_month: cp[0] ? mon(cp[0].date) : null,
      }];
    },
  });

  dash.calc('mfg_context', {
    title: 'Manufacturing benchmarks',
    description: 'Latest Tennessee factory pay and manufacturing jobs for Tennessee, the Nashville metro and the U.S., each with the change from the same month a year earlier.',
    inputs: ['tn_mfg', 'tn_mfg_wage', 'nash_mfg', 'us_mfg'],
    fn: (tn_mfg, tn_mfg_wage, nash_mfg, us_mfg) => {
      const L = (s) => s.filter((r) => r.value != null).sort((a, b) => (a.date < b.date ? 1 : -1));
      const ya = (l) => (l[0] ? l.find((r) => r.date === (Number(l[0].date.slice(0, 4)) - 1) + l[0].date.slice(4)) : null);
      const mon = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
      const r1 = (x) => Math.round(x * 10) / 10;
      const pct = (a, b) => (a && b ? r1((a.value / b.value - 1) * 100) : null);
      const t = L(tn_mfg), w = L(tn_mfg_wage), n = L(nash_mfg), u = L(us_mfg);
      const t1 = ya(t), w1 = ya(w), n1 = ya(n), u1 = ya(u);
      return [{
        wage_month: w[0] ? mon(w[0].date) : null, tn_wage: w[0] ? w[0].value : null, tn_wage_ya: w1 ? w1.value : null, tn_wage_chg_pct: pct(w[0], w1),
        tn_k: t[0] ? t[0].value : null, tn_chg_pct: pct(t[0], t1), tn_month: t[0] ? mon(t[0].date) : null,
        nash_k: n[0] ? r1(n[0].value) : null, nash_chg_k: n[0] && n1 ? r1(n[0].value - n1.value) : null, nash_chg_pct: pct(n[0], n1), nash_month: n[0] ? mon(n[0].date) : null,
        us_m: u[0] ? Math.round(u[0].value / 10) / 100 : null, us_chg_k: u[0] && u1 ? Math.round(u[0].value - u1.value) : null, us_chg_pct: pct(u[0], u1), us_month: u[0] ? mon(u[0].date) : null,
      }];
    },
  });

  dash.calc('mfg_growth', {
    title: 'Manufacturing job growth comparison',
    description: 'Twelve-month percent change in manufacturing jobs for the Nashville metro, Tennessee and the U.S.',
    inputs: ['mfg_context'],
    fn: (mfg_context) => {
      const m = mfg_context[0] || {};
      return [
        { area: 'Nashville metro', chg_pct: m.nash_chg_pct ?? null, month: m.nash_month ?? null },
        { area: 'Tennessee', chg_pct: m.tn_chg_pct ?? null, month: m.tn_month ?? null },
        { area: 'United States', chg_pct: m.us_chg_pct ?? null, month: m.us_month ?? null },
      ];
    },
  });

  dash.calc('mortgage', {
    title: '30-year mortgage rate',
    description: 'Freddie Mac 30-year fixed average, latest week and change from the prior week.',
    inputs: ['mortgage30'],
    fn: (mortgage30) => {
      const l = mortgage30.filter((r) => r.value != null).sort((a, b) => (a.date < b.date ? 1 : -1));
      const day = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      return [{ mortgage: l[0] ? l[0].value : null, mortgage_date: l[0] ? day(l[0].date) : null, mortgage_chg: l[0] && l[1] ? Math.round((l[0].value - l[1].value) * 100) / 100 : null }];
    },
  });

  dash.calc('pipeline', {
    title: 'Announced project totals',
    description: 'Sum of announced investment (billions) and stated jobs across tracked projects, overall and by category.',
    inputs: ['projects'],
    fn: (projects) => {
      const sum = (rows, f) => rows.reduce((s, r) => s + (Number(r[f]) || 0), 0);
      const row = (category, rows) => ({ category, projects: rows.length, invest_b: Math.round(sum(rows, 'investment_m') / 10) / 100, jobs: sum(rows, 'jobs') });
      const cats = [...new Set(projects.map((p) => p.category))];
      return [row('All', projects), ...cats.map((c) => row(c, projects.filter((p) => p.category === c)))];
    },
  });

  dash.calc('deadlines', {
    title: 'Deadlines and events',
    description: 'Dated items from action items, events and programs, one per date and source, soonest first.',
    inputs: ['actions', 'events', 'programs'],
    fn: (actions, events, programs) => {
      const out = [];
      actions.forEach((a) => { if (a.deadline) out.push({ date: String(a.deadline).slice(0, 10), title: a.action, kind: 'Action', source_url: a.source_url }); });
      events.forEach((e) => {
        if (e.date) out.push({ date: String(e.date).slice(0, 10), title: e.event, kind: e.end_date ? 'Opens' : 'Event', source_url: e.source_url });
        if (e.end_date) out.push({ date: String(e.end_date).slice(0, 10), title: e.event, kind: 'Closes', source_url: e.source_url });
      });
      programs.forEach((p) => { if (p.deadline) out.push({ date: String(p.deadline).slice(0, 10), title: p.program, kind: 'Program deadline', source_url: p.source_url }); });
      const seen = new Set();
      return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).filter((r) => { const k = r.date + '|' + r.source_url; if (seen.has(k)) return false; seen.add(k); return true; });
    },
  });

  dash.calc('warn_total', {
    title: 'WARN notice totals',
    description: 'Number of verified WARN notices in the 13 counties and the workers they cover.',
    inputs: ['warn'],
    fn: (warn) => [{ notices: warn.length, workers: warn.reduce((s, r) => s + (Number(r.workers) || 0), 0) }],
  });

  dash.calc('action_count', {
    title: 'Action item count',
    description: 'Number of action items, and how many carry a deadline.',
    inputs: ['actions'],
    fn: (actions) => [{ open: actions.length, with_deadline: actions.filter((a) => a.deadline).length }],
  });

  /* markets & macro */
  dash.calc('mk_spreads', {
    title: 'Corporate bond spreads',
    description: 'Latest investment-grade and high-yield option-adjusted spreads (ICE BofA via FRED), with the change over about a week and since the last reading of the prior year, in percentage points.',
    inputs: ['mk_ig', 'mk_hy'],
    fn: (ig, hy) => {
      const r2 = (x) => Math.round(x * 100) / 100;
      return [['Investment-grade corporate spread', ig], ['High-yield corporate spread', hy]].map(([label, s]) => {
        const l = s.filter((r) => r.value != null).sort((a, b) => (a.date < b.date ? -1 : 1));
        const last = l[l.length - 1];
        if (!last) return { label, value: null, as_of: null, chg_1w: null, chg_ytd: null };
        const wk = new Date(Date.parse(last.date + 'T00:00:00Z') - 7 * 864e5).toISOString().slice(0, 10);
        const back = l.slice().reverse();
        const p1 = back.find((r) => r.date <= wk);
        const ye = back.find((r) => r.date < last.date.slice(0, 4) + '-01-01');
        return { label, value: last.value, as_of: last.date, chg_1w: p1 ? r2(last.value - p1.value) : null, chg_ytd: ye ? r2(last.value - ye.value) : null };
      });
    },
  });
  dash.calc('mk_fiscal', {
    title: 'Federal budget vs. 60-year average',
    description: 'Federal receipts, outlays and the surplus or deficit as a share of GDP for the latest fiscal year, compared with the average of the latest 60 fiscal years (OMB/BEA via FRED); plus total public debt as a share of GDP for the latest quarter.',
    inputs: ['mk_receipts', 'mk_outlays', 'mk_deficit', 'mk_debt'],
    fn: (rec, out, def, debt) => {
      const r2 = (x) => Math.round(x * 100) / 100;
      const L = (s) => s.filter((r) => r.value != null).sort((a, b) => (a.date < b.date ? -1 : 1));
      const one = (measure, s) => {
        const l = L(s);
        if (!l.length) return null;
        const last = l[l.length - 1], w = l.slice(-60);
        const avg = w.reduce((a, r) => a + r.value, 0) / w.length;
        return { measure, period: 'FY' + last.date.slice(0, 4), latest: r2(last.value), avg: r2(avg), avg_label: 'FY' + w[0].date.slice(0, 4) + '–FY' + last.date.slice(0, 4), years: w.length, diff: r2(last.value - avg) };
      };
      const rows = [one('Receipts', rec), one('Outlays', out), one('Surplus or deficit (−)', def)].filter(Boolean);
      const d = L(debt).slice(-1)[0];
      if (d) rows.push({ measure: 'Total public debt', period: 'Q' + (Math.floor((Number(d.date.slice(5, 7)) - 1) / 3) + 1) + ' ' + d.date.slice(0, 4), latest: r2(d.value), avg: null, avg_label: null, years: null, diff: null });
      return rows;
    },
  });

  /* strategic plan: business retention & expansion and recruitment */
  const SP_DAYS = 730; // look-back window for WARN notices and announced projects
  const spCut = (days) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  dash.calc('sp_counties', {
    title: 'Strategic plan: county signals',
    description: 'One row per county: unemployment versus Tennessee, manufacturing jobs and their change from a year earlier, manufacturing location quotient, WARN notices and announced projects in the last 24 months, the largest disclosed manufacturing subsectors, workforce measures, and the retention and recruitment flags used on the Strategic plan tab.',
    inputs: ['mfg_county', 'labor_latest', 'acs_county', 'counties', 'warn', 'projects', 'qcew_subsectors', 'qcew_mfg'],
    fn: (mfg_county, labor_latest, acs_county, counties, warn, projects, qcew_subsectors, qcew_mfg) => {
      const r1 = (x) => Math.round(x * 10) / 10;
      const get = (rows, c) => rows.find((r) => r.county === c) || {};
      const cut = spCut(SP_DAYS);
      const tnL = get(labor_latest, 'Tennessee'), tnA = get(acs_county, 'Tennessee');
      return counties.map((p) => {
        const c = p.county, m = get(mfg_county, c), l = get(labor_latest, c), a = get(acs_county, c), q = get(qcew_mfg, c);
        const w = warn.filter((r) => r.county === c && String(r.notice_date || '') >= cut);
        const pr = projects.filter((r) => r.county === c && String(r.announced || '') >= cut);
        const subs = qcew_subsectors.filter((r) => r.county === c).sort((x, y) => y.jobs - x.jobs).slice(0, 3);
        const warnWorkers = w.reduce((s, r) => s + (Number(r.workers) || 0), 0);
        const projJobs = pr.reduce((s, r) => s + (Number(r.jobs) || 0), 0);
        const mfgChg = m.mfg_jobs_chg_pct ?? null, lq = m.mfg_lq ?? null;
        const flags = {
          retention: w.length > 0 || (mfgChg != null && mfgChg <= -5) || (lq != null && lq >= 3 && mfgChg != null && mfgChg < 0),
          momentum: projJobs >= 100,
          labor: l.rate != null && tnL.rate != null && l.rate >= tnL.rate,
          concentration: lq != null && lq >= 3,
          workforce_gap: a.lfpr_pct != null && tnA.lfpr_pct != null && a.bach_plus_pct != null && tnA.bach_plus_pct != null && a.lfpr_pct < tnA.lfpr_pct && a.bach_plus_pct < tnA.bach_plus_pct,
        };
        const focus = flags.retention ? 'Retain & expand' : flags.momentum ? 'Build on wins' : flags.labor ? 'Market the workforce' : 'Prepare sites & product';
        const why = [];
        if (w.length) why.push(w.length + ' WARN notice' + (w.length > 1 ? 's' : '') + ' (' + warnWorkers + ' workers)');
        if (mfgChg != null && mfgChg <= -5) why.push('factory jobs ' + mfgChg + '% from a year earlier');
        if (lq != null && lq >= 3) why.push('manufacturing ' + lq + '× the national share');
        if (flags.momentum) why.push(projJobs + ' jobs in announced projects');
        if (flags.labor) why.push('unemployment ' + l.rate + '% vs Tennessee ' + tnL.rate + '%');
        if (flags.workforce_gap) why.push("labor force participation and bachelor's attainment below Tennessee");
        const move = flags.retention && w.length ? 'Rapid-response follow-up, then retention visits with the remaining manufacturers'
          : flags.retention ? 'Retention visits with the largest manufacturers: expansion plans, workforce needs, risks'
          : flags.momentum ? 'Recruit suppliers around the new projects; build the hiring pipeline for announced jobs'
          : flags.labor ? 'Market the available workforce and the top industrial site to prospects'
          : 'Ready the top industrial site (due diligence, infrastructure) before marketing it';
        return {
          county: c, tier: p.tier ?? null, tier_label: p.tier_label ?? null, top_park: p.top_park ?? null,
          rate: l.rate ?? null, tn_rate: tnL.rate ?? null, month: l.month ?? null,
          mfg_jobs: m.mfg_jobs ?? null, mfg_chg: m.mfg_jobs_chg ?? null, mfg_chg_pct: mfgChg, mfg_lq: lq, mfg_share_pct: m.mfg_share_pct ?? null, quarter: m.quarter ?? null,
          mfg_wage_wk: q.mfg_wage_wk ?? null, private_wage_wk: q.private_wage_wk ?? null, estabs: q.private_estabs ?? null, estabs_ya: q.private_estabs_ya ?? null,
          warn_notices: w.length, warn_workers: warnWorkers, warn_list: w.map((r) => r.company + ' (' + r.workers + ', ' + String(r.action).toLowerCase() + ')').join('; '),
          proj_count: pr.length, proj_jobs: projJobs, proj_invest_m: r1(pr.reduce((s, r) => s + (Number(r.investment_m) || 0), 0)),
          top_subsectors: subs.map((r) => r.subsector.replace(/ manufacturing$/i, '') + ' (' + r.jobs.toLocaleString('en-US') + ')').join('; '),
          lfpr_pct: a.lfpr_pct ?? null, bach_plus_pct: a.bach_plus_pct ?? null, broadband_pct: a.broadband_pct ?? null, median_age: a.median_age ?? null,
          f_retention: flags.retention, f_momentum: flags.momentum, f_labor: flags.labor, f_concentration: flags.concentration, f_workforce_gap: flags.workforce_gap,
          focus, why: why.join('; '), first_move: move,
        };
      });
    },
  });
  dash.calc('sp_clusters', {
    title: 'Strategic plan: manufacturing clusters',
    description: 'Manufacturing subsectors ranked by disclosed private jobs summed across the 13 counties (BLS QCEW), with the number of counties, the largest county and the jobs-weighted average weekly wage. Figures BLS withholds for privacy are not included, so totals are lower bounds.',
    inputs: ['qcew_subsectors'],
    fn: (qcew_subsectors) => {
      const by = new Map();
      qcew_subsectors.forEach((r) => {
        const e = by.get(r.subsector) || { subsector: r.subsector, jobs: 0, estabs: 0, wages: 0, counties: [], quarter: r.quarter };
        e.jobs += r.jobs; e.estabs += r.estabs; e.wages += r.wage_wk * r.jobs; e.counties.push({ c: r.county, j: r.jobs });
        by.set(r.subsector, e);
      });
      return [...by.values()].sort((a, b) => b.jobs - a.jobs).map((e, i) => ({
        rank: i + 1, subsector: e.subsector.replace(/ manufacturing$/i, ''), jobs: e.jobs, estabs: e.estabs, counties: e.counties.length,
        largest: e.counties.sort((a, b) => b.j - a.j).slice(0, 3).map((x) => x.c).join(', '), wage_wk: e.jobs ? Math.round(e.wages / e.jobs) : null, quarter: e.quarter,
      }));
    },
  });
  dash.calc('sp_employers', {
    title: 'Major employers',
    description: "Employers from Greg Lowe's employer Sheet (notebook research), joined with the monthly web checks (one county a day on the 1st to 13th). A row is shown only when it has a web source: a link in the Sheet or a source found by a web check. Employee counts are as stated by that source.",
    inputs: ['employers', 'employer_checks'],
    fn: (employers, checks) => {
      const k = (c, n) => String(c).toLowerCase() + '|' + String(n).toLowerCase().trim();
      const latest = new Map();
      checks.slice().sort((a, b) => (String(a.checked) < String(b.checked) ? -1 : 1)).forEach((c) => latest.set(k(c.county, c.company), c));
      return employers.filter((e) => e.in_region && !e.duplicate).map((e) => {
        const c = latest.get(k(e.county, e.company)) || null;
        const webOk = c && ['confirmed', 'changed', 'closed'].includes(c.status) && c.source_url;
        const shown = Boolean(e.has_url || webOk);
        let status = 'Waiting for a web link in the Sheet';
        if (c && c.status === 'confirmed') status = 'Web-checked ' + c.checked;
        else if (c && c.status === 'changed') status = 'Updated by web check ' + c.checked + (c.note ? ': ' + c.note : '');
        else if (c && c.status === 'closed') status = 'Closed or left the county, per web check ' + c.checked + (c.note ? ': ' + c.note : '');
        else if (c && c.status === 'not_found' && e.has_url) status = "From Greg's Sheet; web check " + c.checked + ' could not confirm';
        else if (e.has_url) status = "From Greg's Sheet; not yet web-checked";
        else if (c && c.status === 'not_found') status = 'Web check ' + c.checked + ' could not confirm; needs a link';
        return {
          county: e.county, company: e.company, industry: e.industry, shown, status, check_status: c ? c.status : null,
          employees: shown ? (c && c.employees != null ? c.employees : e.employees) : null,
          employees_note: shown ? ((c && c.employees_note) || (e.employees == null ? e.employees_text : null)) : null,
          source_url: (webOk && c.source_url) || e.source_url || null, checked: c ? c.checked : null, sheet_row: e.sheet_row,
        };
      });
    },
  });

  dash.calc('sp_facts', {
    title: 'Strategic plan: regional facts',
    description: 'Regional figures behind the Strategic plan tab: unemployment, manufacturing jobs and share, business establishments, WARN notices and announced projects in the last 24 months, and workforce comparisons with Tennessee.',
    inputs: ['sp_counties', 'labor_region', 'mfg_county', 'acs_county', 'warn', 'projects'],
    fn: (sp, labor_region, mfg_county, acs_county, warn, projects) => {
      const r1 = (x) => Math.round(x * 10) / 10;
      const cut = spCut(SP_DAYS), cut12 = spCut(365);
      const reg = mfg_county.find((r) => r.county === 'Region') || {}, tn = mfg_county.find((r) => r.county === 'Tennessee') || {};
      const lr = labor_region[0] || {};
      const rep = sp.filter((r) => r.mfg_chg_pct != null);
      const est = sp.filter((r) => r.estabs != null && r.estabs_ya);
      const e1 = est.reduce((s, r) => s + r.estabs, 0), e0 = est.reduce((s, r) => s + r.estabs_ya, 0);
      const w = warn.filter((r) => String(r.notice_date || '') >= cut), w12 = warn.filter((r) => String(r.notice_date || '') >= cut12);
      const pr = projects.filter((r) => String(r.announced || '') >= cut);
      const tnA = acs_county.find((r) => r.county === 'Tennessee') || {};
      return [{
        month: lr.month ?? null, rate: lr.rate ?? null, tn_rate: (sp[0] || {}).tn_rate ?? null, rate_chg: lr.rate_chg ?? null,
        quarter: reg.quarter ?? null, mfg_jobs: reg.mfg_jobs ?? null, mfg_chg: reg.mfg_jobs_chg ?? null, mfg_chg_pct: reg.mfg_jobs_chg_pct ?? null,
        mfg_share_pct: reg.mfg_share_pct ?? null, tn_mfg_share_pct: tn.mfg_share_pct ?? null, tn_mfg_chg_pct: tn.mfg_jobs_chg_pct ?? null,
        mfg_down: rep.filter((r) => r.mfg_chg_pct < 0).length, mfg_reporting: rep.length,
        estabs: e1, estabs_ya: e0, estabs_chg_pct: e0 ? r1((e1 / e0 - 1) * 100) : null, estabs_up: est.filter((r) => r.estabs > r.estabs_ya).length, estabs_reporting: est.length,
        warn_notices: w.length, warn_workers: w.reduce((s, r) => s + (Number(r.workers) || 0), 0), warn_workers_12: w12.reduce((s, r) => s + (Number(r.workers) || 0), 0),
        proj_count: pr.length, proj_jobs: pr.reduce((s, r) => s + (Number(r.jobs) || 0), 0), proj_invest_m: r1(pr.reduce((s, r) => s + (Number(r.investment_m) || 0), 0)),
        proj_counties: new Set(pr.map((r) => r.county)).size,
        retention_counties: sp.filter((r) => r.f_retention).length,
        tn_lfpr: tnA.lfpr_pct ?? null, tn_bach: tnA.bach_plus_pct ?? null, tn_broadband: tnA.broadband_pct ?? null, tn_median_age: tnA.median_age ?? null,
        window_start: cut,
      }];
    },
  });

  /* ---------- formatting & helpers ---------- */
  const f1 = (v) => d3.format(',.1f')(v);
  const f2 = (v) => d3.format(',.2f')(v);
  const int = (v) => d3.format(',')(Math.round(v));
  const sgn = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '-' : '') + d3.format(',.' + d + 'f')(Math.abs(v));
  const sgnInt = (v) => (v > 0 ? '+' : v < 0 ? '-' : '') + d3.format(',')(Math.abs(Math.round(v)));
  const str = (v) => String(v);
  const usd = (v) => '$' + int(v);
  const parseDay = (s) => new Date(String(s).slice(0, 10) + 'T00:00:00Z');
  const dayFmt = (s) => parseDay(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const daysUntil = (s) => Math.round((parseDay(s) - parseDay(todayStr())) / 86400000);
  const rowsOf = (id) => { const d = dash.data(id); return d.status === 'ok' && Array.isArray(d.data) ? d.data : null; };
  const selCounty = () => dash.params().county || 'Marshall';
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const link = (url, text) => { const a = h('a', null, text); a.href = url; a.target = '_blank'; a.rel = 'noopener'; return a; };
  const W0 = (el) => Math.max(240, Math.floor(el.clientWidth || el.getBoundingClientRect().width || 320));

  function pending(el, ids_) {
    const st = ids_.map((id) => dash.data(id).status);
    el.replaceChildren();
    if (st.every((s) => s === 'ok')) { el.classList.remove('dash-skeleton'); return false; }
    if (st.some((s) => s === 'error')) { el.classList.remove('dash-skeleton'); el.appendChild(h('div', 'sm-fail', 'Failed to load')); }
    else if (st.some((s) => s === 'loading')) el.classList.add('dash-skeleton');
    else el.classList.remove('dash-skeleton');
    return true;
  }

  function cellOf(el) {
    const id = (el.dataset.source || '').split(' ')[0];
    const rows = rowsOf(id);
    if (!rows) return { status: dash.data(id).status };
    let row;
    if (el.dataset.row != null) row = rows[Number(el.dataset.row)];
    else if (el.dataset.where) {
      const conds = el.dataset.where.split('&').map((p) => p.split('=').map(decodeURIComponent));
      row = rows.find((r) => conds.every(([k, v]) => String(r[k]) === v));
    }
    return { status: 'ok', row, value: row ? row[el.dataset.field] : undefined };
  }

  function valueDraw(name, fmt, opts = {}) {
    dash.draw(name, (el) => {
      if (opts.county) el.dataset.where = 'county=' + selCounty();
      const c = cellOf(el);
      el.classList.remove('good', 'bad');
      if (c.status !== 'ok' || c.value == null || c.value === '') {
        el.textContent = '—';
        el.classList.toggle('dash-skeleton', c.status === 'loading');
        return;
      }
      el.classList.remove('dash-skeleton');
      el.textContent = fmt(c.value, c.row);
      if (opts.goodIf) { const g = opts.goodIf(c.value); if (g != null && c.value !== 0) el.classList.add(g ? 'good' : 'bad'); }
    });
  }

  function measure(svg, text, cls) {
    const t = svg.append('text').attr('class', cls).text(text);
    const w = t.node().getComputedTextLength();
    t.remove();
    return w;
  }

  function tip(el) {
    const t = h('div', 'sm-tip');
    t.hidden = true;
    el.appendChild(t);
    return {
      show(ev, lines) {
        t.replaceChildren(...lines.map((l, i) => h('div', i === 0 ? 'sm-tip-h' : null, l)));
        t.hidden = false;
        const r = el.getBoundingClientRect();
        let x = ev.clientX - r.left + 12, y = ev.clientY - r.top + 12;
        const tw = t.offsetWidth, th = t.offsetHeight;
        if (x + tw > r.width) x = Math.max(0, ev.clientX - r.left - tw - 12);
        if (y + th > r.height) y = Math.max(0, ev.clientY - r.top - th - 12);
        t.style.left = x + 'px';
        t.style.top = y + 'px';
      },
      hide() { t.hidden = true; },
    };
  }

  /* horizontal bars: rows [{label, value, text?, tip?, color?, key?}] */
  function hbars(el, rows, o = {}) {
    if (!rows.length) return;
    const W = W0(el);
    const fmt = o.fmt || int;
    const rowH = 22, gap = 5, top = o.ref ? 18 : 2;
    const H = top + rows.length * (rowH + gap) - gap + 4;
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', o.aria || '');
    const lw = Math.ceil(d3.max(rows, (r) => measure(svg, r.label, 'sm-lbl')) || 0) + 10;
    const vw = Math.ceil(d3.max(rows, (r) => measure(svg, r.text ?? fmt(r.value), 'sm-val')) || 0) + 8;
    const vals = rows.map((r) => r.value).concat(o.ref ? [o.ref.value] : []);
    const lo = Math.min(0, d3.min(vals)), hi = Math.max(0, d3.max(vals));
    const x = d3.scaleLinear([lo, hi || 1], [lw + (lo < 0 ? vw : 0), W - vw]);
    const tt = tip(el);
    rows.forEach((r, i) => {
      const g = svg.append('g').attr('transform', `translate(0,${top + i * (rowH + gap)})`);
      g.append('text').attr('class', 'sm-lbl').attr('x', lw - 10).attr('y', rowH / 2).attr('dy', '0.35em').attr('text-anchor', 'end').text(r.label);
      const x0 = x(0), x1 = x(r.value);
      g.append('rect').attr('x', Math.min(x0, x1)).attr('y', 3).attr('width', Math.max(1, Math.abs(x1 - x0))).attr('height', rowH - 6).attr('rx', 3)
        .style('fill', r.color || dash.colors[0]);
      g.append('text').attr('class', 'sm-val').attr('x', r.value < 0 ? x1 - 4 : x1 + 4).attr('y', rowH / 2).attr('dy', '0.35em')
        .attr('text-anchor', r.value < 0 ? 'end' : 'start').text(r.text ?? fmt(r.value));
      g.append('rect').attr('x', 0).attr('y', 0).attr('width', W).attr('height', rowH).style('fill', 'transparent')
        .style('cursor', o.onClick ? 'pointer' : null)
        .on('mousemove', (ev) => tt.show(ev, [r.label, r.tip || (r.text ?? fmt(r.value))]))
        .on('mouseleave', () => tt.hide())
        .on('click', o.onClick ? () => o.onClick(r) : null);
    });
    if (lo < 0) svg.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', top).attr('y2', H - 2).style('stroke', 'var(--cds-chart-axis)');
    if (o.ref && o.ref.value != null) {
      const xr = x(o.ref.value);
      svg.append('line').attr('x1', xr).attr('x2', xr).attr('y1', top - 2).attr('y2', H - 2).style('stroke', 'var(--cds-chart-reference)').attr('stroke-dasharray', '4 3');
      const tw = measure(svg, o.ref.label, 'sm-tick');
      svg.append('text').attr('class', 'sm-tick').attr('x', Math.min(Math.max(xr, lw + tw / 2), W - tw / 2)).attr('y', 11).attr('text-anchor', 'middle').text(o.ref.label);
    }
  }

  /* line chart: series [{name, values:[{date, value}], color?, width?, dashed?}] */
  function lineChart(el, series, o = {}) {
    const W = W0(el), H = o.height || 220;
    const fmt = o.fmt || f1, yfmt = o.yfmt || fmt;
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', o.aria || '');
    const all = series.flatMap((s) => s.values.filter((v) => v.value != null));
    if (!all.length) return;
    const [mn, mx] = d3.extent(all, (d) => d.value);
    const pad = (mx - mn) * 0.12 || 1;
    const y = d3.scaleLinear([o.zero ? 0 : mn - pad, mx + pad], [H - 22, 10]).nice(4);
    const yt = y.ticks(4);
    const ml = Math.ceil(d3.max(yt, (t) => measure(svg, yfmt(t), 'sm-tick'))) + 8;
    const lastOf = (s) => s.values.filter((v) => v.value != null).slice(-1)[0];
    const endTxt = (s) => s.name + ' ' + fmt(lastOf(s).value);
    const mr = Math.ceil(d3.max(series, (s) => (lastOf(s) ? measure(svg, endTxt(s), 'sm-val') : 0))) + 10;
    const x = d3.scaleUtc(d3.extent(all, (d) => d.date), [ml, W - mr]);
    svg.append('g').selectAll('line').data(yt).join('line').attr('x1', ml).attr('x2', W - mr).attr('y1', (t) => y(t)).attr('y2', (t) => y(t)).style('stroke', 'var(--cds-chart-grid)');
    svg.append('g').selectAll('text').data(yt).join('text').attr('class', 'sm-tick').attr('x', ml - 6).attr('y', (t) => y(t)).attr('dy', '0.35em').attr('text-anchor', 'end').text(yfmt);
    const xf = d3.utcFormat(o.xfmt || "%b '%y");
    let xt = x.ticks(Math.max(2, Math.floor((W - ml - mr) / 70)));
    const xw = d3.max(xt, (t) => measure(svg, xf(t), 'sm-tick')) || 30;
    while (xt.length > 2 && (W - ml - mr) / (xt.length - 1) < xw + 12) xt = xt.filter((_, i) => i % 2 === 0);
    svg.append('g').selectAll('text').data(xt).join('text').attr('class', 'sm-tick').attr('x', (t) => x(t)).attr('y', H - 6).attr('text-anchor', 'middle').text(xf);
    const line = d3.line().defined((d) => d.value != null).x((d) => x(d.date)).y((d) => y(d.value));
    series.forEach((s, i) => {
      svg.append('path').datum(s.values).attr('d', line).style('fill', 'none').style('stroke', s.color || dash.colors[i])
        .style('stroke-width', (s.width || 2) + 'px').style('stroke-linecap', 'round').style('stroke-linejoin', 'round')
        .attr('stroke-dasharray', s.dashed ? '4 3' : null);
    });
    const ends = series.map((s, i) => ({ s, i, l: lastOf(s) })).filter((e) => e.l).map((e) => ({ ...e, y: y(e.l.value) })).sort((a, b) => a.y - b.y);
    for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 13) ends[k].y = ends[k - 1].y + 13;
    ends.forEach((e) => {
      svg.append('circle').attr('cx', x(e.l.date)).attr('cy', y(e.l.value)).attr('r', 3).style('fill', e.s.color || dash.colors[e.i]);
      svg.append('text').attr('class', 'sm-val').attr('x', x(e.l.date) + 6).attr('y', Math.min(e.y, H - 26)).attr('dy', '0.35em').text(endTxt(e.s));
    });
    const tt = tip(el);
    const dates = [...new Set(all.map((d) => +d.date))].sort((a, b) => a - b).map((t) => new Date(t));
    const rule = svg.append('line').attr('y1', 10).attr('y2', H - 22).style('stroke', 'var(--cds-chart-axis)').style('opacity', 0);
    svg.append('rect').attr('x', ml).attr('y', 0).attr('width', Math.max(1, W - ml - mr)).attr('height', H - 20).style('fill', 'transparent')
      .on('mousemove', (ev) => {
        const [px] = d3.pointer(ev);
        const t = x.invert(px);
        const d = dates[d3.leastIndex(dates, (a) => Math.abs(a - t))];
        rule.attr('x1', x(d)).attr('x2', x(d)).style('opacity', 1);
        const lines = [d3.utcFormat(o.tipfmt || '%B %Y')(d)];
        series.forEach((s) => { const p = s.values.find((v) => +v.date === +d); lines.push(s.name + ': ' + (p && p.value != null ? fmt(p.value) : 'no data')); });
        tt.show(ev, lines);
      })
      .on('mouseleave', () => { rule.style('opacity', 0); tt.hide(); });
  }

  /* vertical columns: rows [{label, value, text?}] */
  function cols(el, rows, o = {}) {
    if (!rows.length) return;
    const W = W0(el), H = o.height || 190;
    const fmt = o.fmt || int;
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', o.aria || '');
    const x = d3.scaleBand(rows.map((r) => r.label), [6, W - 6]).padding(0.3);
    const y = d3.scaleLinear([0, d3.max(rows, (r) => r.value) * 1.1 || 1], [H - 20, 16]);
    const tt = tip(el);
    rows.forEach((r) => {
      const bw = Math.min(40, x.bandwidth()), bx = x(r.label) + (x.bandwidth() - bw) / 2;
      svg.append('rect').attr('x', bx).attr('y', y(r.value)).attr('width', bw).attr('height', Math.max(1, y(0) - y(r.value))).attr('rx', 3).style('fill', dash.colors[0])
        .on('mousemove', (ev) => tt.show(ev, [r.label, r.tip || (r.text ?? fmt(r.value))])).on('mouseleave', () => tt.hide());
      svg.append('text').attr('class', 'sm-val').attr('x', x(r.label) + x.bandwidth() / 2).attr('y', y(r.value) - 4).attr('text-anchor', 'middle').text(r.text ?? fmt(r.value));
      svg.append('text').attr('class', 'sm-tick').attr('x', x(r.label) + x.bandwidth() / 2).attr('y', H - 5).attr('text-anchor', 'middle').text(r.label);
    });
    svg.append('line').attr('x1', 6).attr('x2', W - 6).attr('y1', y(0)).attr('y2', y(0)).style('stroke', 'var(--cds-chart-axis)');
  }

  /* tile map of the 13 counties (schematic) */
  const TILE = { Hickman: [1, 0], Perry: [0, 1], Lewis: [1, 1], Maury: [2, 1], Marshall: [3, 1], Bedford: [4, 1], Coffee: [5, 1], Wayne: [0, 2], Lawrence: [1, 2], Giles: [2, 2], Lincoln: [3, 2], Moore: [4, 2], Franklin: [5, 2] };
  function tileMap(el, rows, o) {
    const W = W0(el), gap = 4;
    const s = Math.min(100, Math.floor((W - 5 * gap) / 6));
    const tw = 6 * s + 5 * gap, ox = Math.floor((W - tw) / 2);
    const H = 3 * s + 2 * gap + 30;
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', o.aria || 'County map');
    const vals = rows.map((r) => r.value).filter((v) => v != null);
    const [lo, hi] = o.domain || d3.extent(vals);
    const op = (v) => (v == null ? 0 : 0.14 + 0.86 * (hi === lo ? 1 : (v - lo) / (hi - lo)));
    const fs = Math.max(9, Math.min(12, s / 5.4));
    const tt = tip(el);
    const sel = selCounty();
    rows.forEach((r) => {
      const pos = TILE[r.county];
      if (!pos) return;
      const x = ox + pos[0] * (s + gap), y = pos[1] * (s + gap);
      const g = svg.append('g').attr('class', 'tile').attr('tabindex', 0).attr('role', 'button').attr('aria-label', r.county + ' County: ' + r.text)
        .attr('transform', `translate(${x},${y})`)
        .on('click', () => openCounty(r.county))
        .on('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openCounty(r.county); } })
        .on('mousemove', (ev) => tt.show(ev, [r.county + ' County', r.tip || r.text]))
        .on('mouseleave', () => tt.hide());
      g.append('rect').attr('width', s).attr('height', s).attr('rx', 6).style('fill', 'var(--color-bg)').style('stroke', 'var(--color-border-line)');
      g.append('rect').attr('width', s).attr('height', s).attr('rx', 6).style('fill', dash.colors[0]).style('fill-opacity', op(r.value))
        .style('stroke', r.county === sel ? 'var(--color-fg)' : 'none').style('stroke-width', '2px');
      const dark = op(r.value) > 0.55;
      g.append('text').attr('x', 6).attr('y', fs + 4).style('font-size', fs + 'px').style('fill', dark ? 'var(--color-bg)' : 'var(--color-fg)').style('font-family', 'var(--font-anthropic-sans)').text(r.county);
      g.append('text').attr('x', 6).attr('y', s - 8).style('font-size', fs + 2 + 'px').style('font-weight', 600).style('fill', dark ? 'var(--color-bg)' : 'var(--color-fg)').style('font-family', 'var(--font-anthropic-sans)').text(r.text);
    });
    const ly = 3 * s + 2 * gap + 12;
    const steps = 5, sw = 18;
    svg.append('text').attr('class', 'sm-tick').attr('x', ox).attr('y', ly + 9).text(o.loLabel);
    const lx = ox + measure(svg, o.loLabel, 'sm-tick') + 6;
    for (let i = 0; i < steps; i++) svg.append('rect').attr('x', lx + i * (sw + 2)).attr('y', ly).attr('width', sw).attr('height', 12).attr('rx', 2).style('fill', dash.colors[0]).style('fill-opacity', 0.14 + 0.86 * (i / (steps - 1)));
    svg.append('text').attr('class', 'sm-tick').attr('x', lx + steps * (sw + 2) + 4).attr('y', ly + 9).text(o.hiLabel);
  }

  /* ---------- tabs, links, county selection ---------- */
  function showTab(id) {
    document.querySelectorAll('.sm-page').forEach((s) => { s.hidden = s.id !== id; });
    document.querySelectorAll('.sm-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
    dash.setLink(id);
  }
  function openCounty(c) {
    dash.setParams({ county: c });
    showTab('counties');
    const card = document.getElementById('card-profile');
    if (card) card.scrollIntoView({ block: 'start' });
  }
  document.querySelectorAll('.sm-tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  document.querySelectorAll('.sm-chip').forEach((b) => b.addEventListener('click', () => dash.setParams({ county: b.dataset.county })));
  document.querySelectorAll('.sm-seg button[data-map]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.sm-seg button[data-map]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    document.querySelectorAll('[data-mapview]').forEach((m) => { m.hidden = m.dataset.mapview !== b.dataset.map; });
  }));
  document.querySelectorAll('.sm-syncbtn').forEach((b) => b.addEventListener('click', () => {
    b.classList.add('is-syncing');
    b.disabled = true;
    SYNC_IDS.forEach((id, i) => setTimeout(() => dash.refresh(id), Math.floor(i / 4) * 2500));
    setTimeout(() => { b.classList.remove('is-syncing'); b.disabled = false; }, Math.ceil(SYNC_IDS.length / 4) * 2500 + 1500);
  }));
  const startTab = location.hash.slice(1);
  const startEl = startTab ? document.getElementById(startTab) : null;
  if (startEl && startEl.classList.contains('sm-page')) showTab(startTab);

  /* sortable tables */
  const SORT = { labor: { key: 'rate', dir: -1, draw: 'w_table' }, compare: { key: 'county', dir: 1, draw: 'cmp_body' } };
  document.querySelectorAll('table[data-sort-table]').forEach((t) => {
    const st = SORT[t.dataset.sortTable];
    const mark = () => t.querySelectorAll('th').forEach((th) => {
      const b = th.querySelector('.sm-sort');
      if (b && b.dataset.sort === st.key) th.setAttribute('aria-sort', st.dir > 0 ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });
    mark();
    t.querySelectorAll('.sm-sort').forEach((b) => b.addEventListener('click', () => {
      if (st.key === b.dataset.sort) st.dir = -st.dir; else { st.key = b.dataset.sort; st.dir = b.dataset.sort === 'county' ? 1 : -1; }
      mark();
      dash.draw(st.draw);
    }));
  });
  const sortRows = (rows, st) => rows.slice().sort((a, b) => {
    const x = a[st.key], y = b[st.key];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * st.dir;
  });
  let cmpQuery = '';
  document.querySelectorAll('#cmp-search').forEach((i) => i.addEventListener('input', () => { cmpQuery = i.value.trim().toLowerCase(); dash.draw('cmp_body'); }));
  document.querySelectorAll('table[data-sort-table="compare"] tbody').forEach((tb) => tb.addEventListener('click', (ev) => {
    const tr = ev.target.closest('tr[data-key]');
    if (tr) { dash.setParams({ county: tr.dataset.key }); const card = document.getElementById('card-profile'); if (card) card.scrollIntoView({ block: 'start' }); }
  }));

  dash.onData(() => {
    const c = selCounty();
    document.querySelectorAll('.sm-chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.county === c)));
  });

  /* ---------- drawings: header ---------- */
  valueDraw('t_rate', f1); valueDraw('t_month', str); valueDraw('t_rateya', f1);
  valueDraw('t_hic', str); valueDraw('t_hi', f1); valueDraw('t_loc', str); valueDraw('t_lo', f1); valueDraw('fresh_month', str);
  dash.draw('t_dir', (el) => {
    const r = rowsOf('labor_region');
    const v = r && r[0] ? r[0].rate_chg : null;
    el.textContent = v == null ? '—' : v < 0 ? 'down' : v > 0 ? 'up' : 'unchanged';
  });

  /* overview */
  valueDraw('k_rate', f1); valueDraw('k_rate_chg', (v) => sgn(v), { goodIf: (v) => v < 0 }); valueDraw('k_rate_ya', str);
  valueDraw('k_lf', int); valueDraw('k_lf_chg', (v) => sgn(v), { goodIf: (v) => v > 0 });
  valueDraw('k_mfg_q', str); valueDraw('k_mfg', int); valueDraw('k_mfg_chg', sgnInt, { goodIf: (v) => v > 0 });
  valueDraw('k_tn', f1); valueDraw('k_us', f1);
  valueDraw('k_inv', f2); valueDraw('k_jobs', int); valueDraw('k_projects', int);
  dash.draw('k_next', (el) => {
    el.replaceChildren();
    const rows = rowsOf('deadlines');
    if (!rows) { el.textContent = '—'; return; }
    const t = todayStr();
    const n = rows.find((r) => r.date >= t);
    if (!n) { el.appendChild(h('span', 'sm-kpi-value', 'None')); return; }
    const d = daysUntil(n.date);
    el.appendChild(h('span', 'sm-kpi-value', parseDay(n.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })));
    el.appendChild(h('span', 'sm-kpi-sub', (d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : 'In ' + d + ' days') + ' · ' + n.title));
  });

  const mapDraw = (name, id, valueOf, textOf, o) => dash.draw(name, (el) => {
    if (pending(el, [id])) return;
    const rows = rowsOf(id).filter((r) => COUNTIES.includes(r.county)).map((r) => ({ county: r.county, value: valueOf(r), text: textOf(r) }));
    tileMap(el, rows, o);
  });
  mapDraw('map_rate', 'labor_latest', (r) => r.rate, (r) => (r.rate == null ? '—' : f1(r.rate) + '%'), { loLabel: 'Lower', hiLabel: 'Higher unemployment', aria: 'Map of unemployment by county' });
  mapDraw('map_pop', 'pop_county', (r) => r.chg_since_base_pct, (r) => (r.chg_since_base_pct == null ? '—' : sgn(r.chg_since_base_pct) + '%'), { loLabel: 'Slower', hiLabel: 'Faster growth', aria: 'Map of population growth by county' });
  mapDraw('map_mhi', 'income_county', (r) => r.mhi, (r) => (r.mhi == null ? '—' : '$' + Math.round(r.mhi / 1000) + 'K'), { loLabel: 'Lower', hiLabel: 'Higher income', aria: 'Map of median household income by county' });
  mapDraw('map_pov', 'income_county', (r) => r.poverty, (r) => (r.poverty == null ? '—' : f1(r.poverty) + '%'), { loLabel: 'Lower', hiLabel: 'Higher poverty', aria: 'Map of poverty rate by county' });
  mapDraw('map_bach', 'edu_county', (r) => r.bach_pct, (r) => (r.bach_pct == null ? '—' : f1(r.bach_pct) + '%'), { loLabel: 'Lower', hiLabel: 'Higher share', aria: "Map of bachelor's degree share by county" });
  mapDraw('map_mfg', 'mfg_county', (r) => r.mfg_lq, (r) => (r.mfg_lq == null ? 'n/a' : f1(r.mfg_lq) + 'x'), { loLabel: 'Less', hiLabel: 'More concentrated (vs U.S.)', aria: 'Map of manufacturing concentration by county' });
  mapDraw('map_farm', 'ag_county', (r) => r.sales_m, (r) => (r.sales_m == null ? '—' : '$' + Math.round(r.sales_m) + 'M'), { loLabel: 'Lower', hiLabel: 'Higher farm sales', aria: 'Map of farm product sales by county' });
  dash.draw('map_tier', (el) => {
    if (pending(el, ['counties'])) return;
    tileMap(el, rowsOf('counties').map((r) => ({ county: r.county, value: r.tier, text: 'Tier ' + r.tier, tip: r.tier_label })), { domain: [1, 4], loLabel: 'Tier 1', hiLabel: 'Tier 4 (most assistance)', aria: 'Map of jobs tax credit tier by county' });
  });

  dash.draw('ov_urn_bars', (el) => {
    if (pending(el, ['labor_latest'])) return;
    const tnRow = rowsOf('labor_latest').find((r) => r.county === 'Tennessee');
    const tn = tnRow && tnRow.rate != null ? { value: tnRow.rate } : null;
    const rows = rowsOf('labor_latest').filter((r) => COUNTIES.includes(r.county) && r.rate != null).sort((a, b) => b.rate - a.rate)
      .map((r) => ({ label: r.county, value: r.rate, text: f1(r.rate) + '%', tip: f1(r.rate) + '% · year ago ' + (r.rate_ya == null ? '—' : f1(r.rate_ya) + '%'), county: r.county }));
    hbars(el, rows, { ref: tn ? { value: tn.value, label: 'TN ' + f1(tn.value) + '%' } : null, onClick: (r) => openCounty(r.county), aria: 'Unemployment rate by county' });
  });

  dash.draw('ov_deadlines', (el) => {
    el.replaceChildren();
    const rows = rowsOf('deadlines');
    if (!rows) return;
    const t = todayStr();
    const soon = rows.filter((r) => r.date >= t && daysUntil(r.date) <= 60);
    if (!soon.length) { el.appendChild(h('li', 'sm-item sm-note', 'Nothing dated in the next 60 days.')); return; }
    soon.forEach((r) => {
      const d = daysUntil(r.date);
      const li = h('li', 'sm-item');
      const top = h('div', 'sm-item-top');
      top.appendChild(h('span', 'sm-item-title', r.title));
      top.appendChild(h('span', 'sm-pill ' + (d <= 7 ? 'late' : d <= 21 ? 'soon' : ''), d === 0 ? 'Today' : 'In ' + d + ' days'));
      li.appendChild(top);
      const meta = h('span', 'sm-item-meta', r.kind + ' · ' + dayFmt(r.date) + ' · ');
      if (r.source_url) meta.appendChild(link(r.source_url, 'Source ↗'));
      li.appendChild(meta);
      el.appendChild(li);
    });
  });

  const intelItem = (r) => {
    const li = h('li', 'sm-item');
    const top = h('div', 'sm-item-top');
    top.appendChild(h('span', 'sm-item-title', r.headline));
    top.appendChild(h('span', 'sm-pill', r.topic));
    li.appendChild(top);
    li.appendChild(h('span', 'sm-item-meta', dayFmt(r.date)));
    const det = h('details');
    det.appendChild(h('summary', null, 'Read more'));
    det.appendChild(h('p', null, r.body));
    if (r.source_url) { const p = h('p'); p.appendChild(link(r.source_url, 'Source ↗')); det.appendChild(p); }
    li.appendChild(det);
    return li;
  };
  dash.draw('ov_intel', (el) => {
    el.replaceChildren();
    const rows = rowsOf('intel');
    if (!rows) return;
    rows.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 4).forEach((r) => el.appendChild(intelItem(r)));
  });

  /* labor & workforce */
  valueDraw('w_nf', f1); valueDraw('w_nf_chg', (v) => sgn(v), { goodIf: (v) => v > 0 });
  valueDraw('w_cl_wk', str); valueDraw('w_cl', int); valueDraw('w_cl_prev', int);
  valueDraw('w_tn', f1); valueDraw('w_us', f1);
  valueDraw('w_lf', int); valueDraw('w_lf_chg', sgnInt, { goodIf: (v) => v > 0 });

  dash.draw('w_mult', (el) => {
    if (pending(el, ['urn_trend'])) return;
    const rows = rowsOf('urn_trend');
    const by = d3.group(rows, (r) => r.series);
    const tn = (by.get('Tennessee') || []).map((r) => ({ date: parseDay(r.date), value: r.rate }));
    const vals = rows.filter((r) => r.rate != null && COUNTIES.includes(r.series)).map((r) => r.rate);
    const ydom = [Math.floor(d3.min(vals)), Math.ceil(d3.max(vals))];
    const tt = tip(el);
    COUNTIES.forEach((c) => {
      const pts = (by.get(c) || []).map((r) => ({ date: parseDay(r.date), value: r.rate }));
      const last = pts.filter((p) => p.value != null).slice(-1)[0];
      const box = h('div', 'sm-mini');
      const hd = h('div', 'sm-mini-h');
      hd.appendChild(h('span', null, c));
      hd.appendChild(h('span', null, last ? f1(last.value) + '%' : '—'));
      box.appendChild(hd);
      el.appendChild(box);
      const w = Math.max(120, box.clientWidth - 16), hh = 64;
      const x = d3.scaleUtc(d3.extent(pts, (p) => p.date), [2, w - 4]);
      const y = d3.scaleLinear(ydom, [hh - 4, 4]);
      const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${w} ${hh}`).attr('role', 'img').attr('aria-label', c + ' unemployment trend');
      const line = d3.line().defined((d) => d.value != null).x((d) => x(d.date)).y((d) => y(d.value));
      svg.append('path').datum(tn).attr('d', line).style('fill', 'none').style('stroke', 'var(--cds-chart-muted)').style('stroke-width', '1.5px').attr('stroke-dasharray', '3 3');
      svg.append('path').datum(pts).attr('d', line).style('fill', 'none').style('stroke', dash.colors[0]).style('stroke-width', '2px').style('stroke-linejoin', 'round').style('stroke-linecap', 'round');
      if (last) svg.append('circle').attr('cx', x(last.date)).attr('cy', y(last.value)).attr('r', 2.5).style('fill', dash.colors[0]);
      svg.append('rect').attr('width', w).attr('height', hh).style('fill', 'transparent').style('cursor', 'pointer')
        .on('mousemove', (ev) => {
          const [px] = d3.pointer(ev);
          const p = pts[d3.leastIndex(pts, (q) => Math.abs(x(q.date) - px))];
          const tp = tn.find((q) => +q.date === +p.date);
          tt.show(ev, [c + ' · ' + d3.utcFormat('%b %Y')(p.date), (p.value == null ? 'no data' : f1(p.value) + '%') + (tp && tp.value != null ? ' (TN ' + f1(tp.value) + '%)' : '')]);
        })
        .on('mouseleave', () => tt.hide())
        .on('click', () => openCounty(c));
    });
  });

  dash.draw('w_region_line', (el) => {
    if (pending(el, ['urn_trend'])) return;
    const rows = rowsOf('urn_trend');
    const ser = (name) => rows.filter((r) => r.series === name).map((r) => ({ date: parseDay(r.date), value: r.rate }));
    lineChart(el, [
      { name: 'Region', values: ser('Region'), color: dash.colors[0] },
      { name: 'TN', values: ser('Tennessee'), color: 'var(--cds-chart-muted)', dashed: true },
    ], { fmt: (v) => f1(v) + '%', yfmt: (v) => f1(v) + '%', aria: 'Region and Tennessee unemployment over time' });
  });

  dash.draw('w_table', (el) => {
    el.replaceChildren();
    const rows = rowsOf('labor_latest');
    if (!rows) return;
    sortRows(rows.filter((r) => COUNTIES.includes(r.county)), SORT.labor).forEach((r) => {
      const tr = h('tr');
      [r.county, r.rate == null ? '—' : f1(r.rate), r.rate_ya == null ? '—' : f1(r.rate_ya), r.rate_chg == null ? '—' : sgn(r.rate_chg),
        r.lf == null ? '—' : int(r.lf), r.lf_chg_pct == null ? '—' : sgn(r.lf_chg_pct)].forEach((v) => tr.appendChild(h('td', null, v)));
      el.appendChild(tr);
    });
  });

  valueDraw('w_warn_total', int); valueDraw('w_warn_n', int);
  dash.draw('w_warn', (el) => {
    el.replaceChildren();
    const rows = rowsOf('warn');
    if (!rows) return;
    rows.slice().sort((a, b) => (String(a.notice_date) < String(b.notice_date) ? 1 : -1)).forEach((r) => {
      const li = h('li', 'sm-item');
      const top = h('div', 'sm-item-top');
      top.appendChild(h('span', 'sm-item-title', r.company + ' · ' + int(r.workers) + ' workers'));
      top.appendChild(h('span', 'sm-pill ' + (r.action === 'Closure' ? 'late' : 'soon'), r.action));
      li.appendChild(top);
      const meta = h('span', 'sm-item-meta', r.city + ', ' + r.county + ' County · notice ' + dayFmt(r.notice_date) + ' · effective ' + dayFmt(r.effective_date) + ' · ');
      if (r.source_url) meta.appendChild(link(r.source_url, 'Source ↗'));
      li.appendChild(meta);
      if (r.note) li.appendChild(h('p', null, r.note));
      el.appendChild(li);
    });
  });
  const verifiedPill = (r) => h('span', 'sm-pill ' + (r.profile_verified ? 'ok' : 'unv'), r.profile_verified ? 'Verified ' + (r.profile_checked || '') : 'Unverified');
  dash.draw('w_signals', (el) => {
    el.replaceChildren();
    const rows = rowsOf('counties');
    if (!rows) return;
    rows.forEach((r) => {
      const li = h('li', 'sm-item');
      const top = h('div', 'sm-item-top');
      top.appendChild(h('span', 'sm-item-title', r.county));
      top.appendChild(verifiedPill(r));
      li.appendChild(top);
      li.appendChild(h('p', null, r.workforce_signal || '—'));
      el.appendChild(li);
    });
  });

  /* people & income */
  valueDraw('p_year', str); valueDraw('p_pop', int); valueDraw('p_pop_add', sgnInt); valueDraw('p_base', str); valueDraw('p_growth_base', str);
  valueDraw('p_tn_mhi', int); valueDraw('p_tn_mhi_y', str); valueDraw('p_tn_pov', f1); valueDraw('p_tn_pcpi', int); valueDraw('p_tn_pcpi_y', str);
  dash.draw('p_pop_bars', (el) => {
    if (pending(el, ['pop_county'])) return;
    hbars(el, rowsOf('pop_county').filter((r) => r.pop != null).sort((a, b) => b.pop - a.pop).map((r) => ({ label: r.county, value: r.pop, county: r.county, tip: int(r.pop) + ' (' + r.year + ')' })), { onClick: (r) => openCounty(r.county), aria: 'Population by county' });
  });
  dash.draw('p_growth_bars', (el) => {
    if (pending(el, ['pop_county'])) return;
    hbars(el, rowsOf('pop_county').filter((r) => r.chg_since_base_pct != null).sort((a, b) => b.chg_since_base_pct - a.chg_since_base_pct)
      .map((r) => ({ label: r.county, value: r.chg_since_base_pct, text: sgn(r.chg_since_base_pct) + '%', county: r.county, tip: sgn(r.chg_since_base_pct) + '% from ' + r.base_year + ' to ' + r.year })), { onClick: (r) => openCounty(r.county), aria: 'Population growth by county' });
  });
  dash.draw('p_region_cols', (el) => {
    if (pending(el, ['pop_region'])) return;
    cols(el, rowsOf('pop_region').slice().reverse().map((r) => ({ label: String(r.year), value: r.pop, text: Math.round(r.pop / 1000) + 'K', tip: int(r.pop) })), { aria: 'Region population by year' });
  });
  const incomeBars = (name, field, fmt, refLabel) => dash.draw(name, (el) => {
    if (pending(el, ['income_county'])) return;
    const rows = rowsOf('income_county');
    const tn = rows.find((r) => r.county === 'Tennessee');
    hbars(el, rows.filter((r) => r.county !== 'Tennessee' && r[field] != null).sort((a, b) => b[field] - a[field])
      .map((r) => ({ label: r.county, value: r[field], text: fmt(r[field]), county: r.county })),
    { ref: tn && tn[field] != null ? { value: tn[field], label: refLabel + ' ' + fmt(tn[field]) } : null, onClick: (r) => openCounty(r.county) });
  });
  incomeBars('p_mhi_bars', 'mhi', (v) => '$' + Math.round(v / 1000) + 'K', 'TN');
  incomeBars('p_pov_bars', 'poverty', (v) => f1(v) + '%', 'TN');
  incomeBars('p_pcpi_bars', 'pcpi', (v) => '$' + Math.round(v / 1000) + 'K', 'TN');

  /* economy */
  valueDraw('e_year', str); valueDraw('e_growth_base', str); valueDraw('e_gdp', f1); valueDraw('e_gdp_chg', (v) => sgn(v), { goodIf: (v) => v > 0 });
  valueDraw('e_10y', f2); valueDraw('e_10y_d', str); valueDraw('e_mtg', f2); valueDraw('e_mtg_chg', (v) => sgn(v, 2));
  valueDraw('e_fed', f2); valueDraw('e_fed_d', str); valueDraw('e_cpi', f1); valueDraw('e_cpi_m', str);
  dash.draw('e_gdp_bars', (el) => {
    if (pending(el, ['gdp_county'])) return;
    hbars(el, rowsOf('gdp_county').filter((r) => r.gdp_b != null).sort((a, b) => b.gdp_b - a.gdp_b)
      .map((r) => ({ label: r.county, value: r.gdp_b, text: '$' + f2(r.gdp_b) + 'B', county: r.county, tip: '$' + f2(r.gdp_b) + 'B in ' + r.year })), { onClick: (r) => openCounty(r.county) });
  });
  dash.draw('e_gdp_growth', (el) => {
    if (pending(el, ['gdp_county'])) return;
    hbars(el, rowsOf('gdp_county').filter((r) => r.chg_since_base_pct != null).sort((a, b) => b.chg_since_base_pct - a.chg_since_base_pct)
      .map((r) => ({ label: r.county, value: r.chg_since_base_pct, text: sgn(r.chg_since_base_pct) + '%', county: r.county, tip: sgn(r.chg_since_base_pct) + '% from ' + r.base_year + ' to ' + r.year })), { onClick: (r) => openCounty(r.county) });
  });
  dash.draw('e_gdp_cols', (el) => {
    if (pending(el, ['gdp_region'])) return;
    cols(el, rowsOf('gdp_region').slice().reverse().map((r) => ({ label: String(r.year), value: r.gdp_b, text: '$' + f1(r.gdp_b) + 'B' })));
  });
  dash.draw('e_biz_bars', (el) => {
    if (pending(el, ['biz_county'])) return;
    hbars(el, rowsOf('biz_county').filter((r) => r.est != null).sort((a, b) => b.est - a.est)
      .map((r) => ({ label: r.county, value: r.est, text: int(r.est) + (r.est_chg == null ? '' : ' (' + sgnInt(r.est_chg) + ')'), county: r.county, tip: int(r.est) + ' in ' + r.quarter })), { onClick: (r) => openCounty(r.county) });
  });

  /* U.S. economy (EconVitals) */
  const evRows = (g) => { const r = rowsOf('econvitals'); return r ? r.filter((x) => x.group === g).sort((a, b) => a.order - b.order) : null; };
  dash.draw('ev_glance', (el) => {
    el.replaceChildren();
    const rows = evRows('At a glance');
    if (!rows) { el.classList.toggle('dash-skeleton', dash.data('econvitals').status === 'loading'); return; }
    el.classList.remove('dash-skeleton');
    rows.forEach((r) => {
      const t = h('div', 'sm-kpi');
      t.appendChild(h('span', 'sm-kpi-label', r.label));
      t.appendChild(h('span', 'sm-kpi-value', r.display ?? '—'));
      t.appendChild(h('span', 'sm-kpi-sub', [r.period, r.change].filter(Boolean).join(' · ')));
      el.appendChild(t);
    });
  });
  dash.draw('ev_nowcast', (el) => {
    if (pending(el, ['econvitals'])) return;
    hbars(el, evRows('GDP nowcast').filter((r) => r.value != null).map((r) => ({ label: r.label, value: r.value, text: r.display, tip: r.period })), { aria: 'GDP nowcasts for the current quarter' });
  });
  dash.draw('ev_jobs', (el) => {
    if (pending(el, ['econvitals'])) return;
    hbars(el, evRows('Job gains').filter((r) => r.value != null).map((r) => ({ label: r.label, value: r.value, text: r.display, tip: (r.change || '') + ' · through ' + r.period })), { aria: 'U.S. job gains by sector' });
  });
  dash.draw('ev_yields', (el) => {
    if (pending(el, ['econvitals'])) return;
    cols(el, evRows('Treasury yields').filter((r) => r.value != null).map((r) => ({ label: r.label, value: r.value, text: r.display, tip: (r.change || '') + ' · ' + r.period })), { aria: 'Treasury yields by maturity' });
  });

  /* strategic plan */
  const spF = () => { const r = rowsOf('sp_facts'); return r && r[0]; };
  const spList = (arr) => (arr.length <= 2 ? arr.join(' and ') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]);
  const SP_PLAN_START = '2026-11-09'; // fixed plan start date (set by Greg Lowe); target dates count from here
  const spDue = (days) => new Date(Date.parse(SP_PLAN_START + 'T00:00:00Z') + days * 864e5).toISOString().slice(0, 10);
  const spDate = (days) => dayFmt(spDue(days));
  dash.draw('sp_asof', (el) => {
    const f = spF();
    el.textContent = f ? 'Built from: unemployment for ' + (f.month || '—') + ' (BLS), manufacturing and business counts for ' + (f.quarter || '—') + ' (BLS QCEW), Census ACS workforce measures, and WARN notices and project announcements since ' + dayFmt(f.window_start) + '.' : '';
  });
  dash.draw('sp_kpis', (el) => {
    el.replaceChildren();
    const f = spF();
    if (!f) { el.classList.toggle('dash-skeleton', ['sp_facts', 'labor_region', 'mfg_county'].some((id) => dash.data(id).status === 'loading')); return; }
    el.classList.remove('dash-skeleton');
    const tile = (label, value, sub) => { const k = h('div', 'sm-kpi'); k.appendChild(h('span', 'sm-kpi-label', label)); k.appendChild(h('span', 'sm-kpi-value', value)); k.appendChild(h('span', 'sm-kpi-sub', sub)); el.appendChild(k); };
    if (f.rate != null) tile('Region unemployment', f1(f.rate) + '%', (f.month || '') + (f.tn_rate != null ? ' · Tennessee ' + f1(f.tn_rate) + '%' : ''));
    if (f.mfg_jobs != null) tile('Manufacturing jobs', int(f.mfg_jobs), (f.mfg_chg_pct != null ? sgn(f.mfg_chg_pct) + '% from a year earlier' : '') + ' · ' + f.quarter);
    if (f.mfg_reporting) tile('Counties losing factory jobs', f.mfg_down + ' of ' + f.mfg_reporting, 'Tennessee ' + (f.tn_mfg_chg_pct != null ? sgn(f.tn_mfg_chg_pct) + '%' : '—') + ' over the same year');
    if (f.estabs) tile('Private business locations', int(f.estabs), sgn(f.estabs_chg_pct) + '% from a year earlier · up in ' + f.estabs_up + ' of ' + f.estabs_reporting + ' counties');
    tile('Workers in WARN notices', int(f.warn_workers), f.warn_notices + ' notice' + (f.warn_notices === 1 ? '' : 's') + ' in the last 24 months');
    tile('Jobs in announced projects', int(f.proj_jobs), f.proj_count + ' projects, $' + f1(f.proj_invest_m) + 'M, in ' + f.proj_counties + ' of 13 counties (24 months)');
  });
  function spSwotData() {
    const f = spF(), sp = rowsOf('sp_counties'), cl = rowsOf('sp_clusters');
    if (!f || !sp || !cl) return null;
    const Q = { Strengths: [], Weaknesses: [], Opportunities: [], Threats: [] };
    const add = (q, text, src) => Q[q].push({ text, src });
    // strengths
    if (f.mfg_share_pct != null && f.tn_mfg_share_pct != null) add('Strengths', 'Manufacturing is the backbone: ' + f1(f.mfg_share_pct) + '% of private jobs are in manufacturing, versus ' + f1(f.tn_mfg_share_pct) + '% statewide.', 'BLS QCEW ' + f.quarter);
    const paid = sp.filter((r) => r.mfg_wage_wk != null && r.private_wage_wk != null);
    const prem = paid.filter((r) => r.mfg_wage_wk > r.private_wage_wk);
    if (paid.length) add('Strengths', 'Factory jobs pay a premium: average weekly manufacturing pay beats the private-sector average in ' + prem.length + ' of ' + paid.length + ' counties.', 'BLS QCEW ' + f.quarter);
    if (f.estabs_chg_pct != null && f.estabs_chg_pct > 0) add('Strengths', 'Business formation is up: private business locations grew ' + sgn(f.estabs_chg_pct) + '% in a year, rising in ' + f.estabs_up + ' of ' + f.estabs_reporting + ' counties.', 'BLS QCEW ' + f.quarter);
    if (f.proj_count) {
      const lead = sp.slice().sort((a, b) => b.proj_count - a.proj_count)[0];
      add('Strengths', 'Recent wins: ' + f.proj_count + ' announced projects with ' + int(f.proj_jobs) + ' stated jobs and $' + f1(f.proj_invest_m) + 'M of investment in the last 24 months, led by ' + lead.county + ' (' + lead.proj_count + ').', 'Projects & grants tab');
    }
    // weaknesses
    const down = sp.filter((r) => r.mfg_chg_pct != null && r.mfg_chg_pct < 0).sort((a, b) => a.mfg_chg_pct - b.mfg_chg_pct);
    if (down.length) add('Weaknesses', 'Factory employment is shrinking: manufacturing jobs fell in ' + f.mfg_down + ' of ' + f.mfg_reporting + ' reporting counties (' + sgnInt(f.mfg_chg) + ' jobs, ' + sgn(f.mfg_chg_pct) + '%; Tennessee ' + sgn(f.tn_mfg_chg_pct) + '%). Steepest: ' + spList(down.slice(0, 3).map((r) => r.county + ' ' + sgn(r.mfg_chg_pct) + '%')) + '.', 'BLS QCEW ' + f.quarter);
    const gap = (field, tnv, label, unit) => {
      const lo = sp.filter((r) => r[field] != null && tnv != null && r[field] < tnv).sort((a, b) => a[field] - b[field]);
      if (lo.length) add('Weaknesses', label + ' trails Tennessee (' + f1(tnv) + unit + ') in ' + lo.length + ' of 13 counties; lowest: ' + lo[0].county + ' ' + f1(lo[0][field]) + unit + '.', 'Census ACS 5-year');
    };
    gap('bach_plus_pct', f.tn_bach, "Bachelor's degree attainment", '%');
    gap('lfpr_pct', f.tn_lfpr, 'Labor force participation', '%');
    gap('broadband_pct', f.tn_broadband, 'Home broadband', '%');
    // opportunities
    if (cl.length) add('Opportunities', 'Recruit suppliers to existing clusters: the largest disclosed manufacturing clusters are ' + spList(cl.slice(0, 3).map((r) => r.subsector.toLowerCase() + ' (' + int(r.jobs) + ' jobs in ' + r.counties + ' counties)')) + '.', 'BLS QCEW ' + (cl[0].quarter || ''));
    const avail = sp.filter((r) => r.f_labor).map((r) => r.county + ' ' + f1(r.rate) + '%');
    if (avail.length) add('Opportunities', 'Available workers: unemployment is at or above Tennessee (' + f1(f.tn_rate) + '%) in ' + spList(avail) + '.', 'BLS LAUS ' + (f.month || ''));
    const tiers = sp.filter((r) => /Tier (3|4)/.test(String(r.tier_label || r.tier || ''))).map((r) => r.county + ' (' + (r.tier_label || 'Tier ' + r.tier) + ')');
    if (tiers.length) add('Opportunities', 'Upper incentive tiers: ' + spList(tiers) + ' sit in Tier 3 or 4 of TNECD\'s tax credit tier map. Confirm current incentive levels with TNECD.', 'TNECD tier map FY2025-26');
    const prog = (rowsOf('programs') || []).filter((r) => r.deadline && r.deadline >= todayStr()).sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
    if (prog.length) add('Opportunities', 'Open funding: ' + spList(prog.slice(0, 3).map((r) => r.program + ' (due ' + dayFmt(r.deadline) + ')')) + '.', 'Projects & grants tab');
    // threats
    if (f.warn_notices) add('Threats', 'Layoffs and closures: ' + f.warn_notices + ' WARN notices in the last 24 months cover ' + int(f.warn_workers) + ' workers: ' + sp.filter((r) => r.warn_notices).map((r) => r.county + ': ' + r.warn_list).join('; ') + '.', 'Tennessee WARN notices');
    const conc = sp.filter((r) => r.f_concentration).sort((a, b) => b.mfg_lq - a.mfg_lq).map((r) => r.county + ' ' + f2(r.mfg_lq) + '×');
    if (conc.length) add('Threats', 'Concentration risk: manufacturing is 3 or more times the national share of jobs in ' + spList(conc) + ', so one plant decision can move the whole county.', 'BLS QCEW location quotients');
    const old = sp.filter((r) => r.median_age != null && f.tn_median_age != null && r.median_age > f.tn_median_age + 2).sort((a, b) => b.median_age - a.median_age);
    if (old.length) add('Threats', 'Aging workforce: median age is more than 2 years above Tennessee (' + f1(f.tn_median_age) + ') in ' + old.length + ' counties; oldest: ' + old[0].county + ' ' + f1(old[0].median_age) + '.', 'Census ACS 5-year');
    const mt = rowsOf('markets_tape');
    const t10 = mt && mt.find((r) => r.kind === 'tape' && r.label === '10-year'), mo = mt && mt.find((r) => r.kind === 'tape' && r.label === '30-year mortgage');
    if (t10) add('Threats', 'Higher borrowing costs: the 10-year Treasury is ' + f2(t10.value) + '% (' + (t10.chg_ytd != null ? sgnInt(t10.chg_ytd * 100) + ' bp this year' : '') + ')' + (mo ? ' and the 30-year mortgage ' + f2(mo.value) + '%' : '') + ', raising the cost of expansions, spec buildings and housing.', 'EconVitals ' + dayFmt(t10.as_of));
    return Q;
  }
  dash.draw('sp_swot', (el) => {
    if (pending(el, ['sp_facts', 'sp_counties', 'sp_clusters'])) return;
    const Q = spSwotData();
    el.replaceChildren();
    const box = h('div', 'sm-swot');
    Object.entries(Q).forEach(([q, items]) => {
      const d = h('div', 'sm-swot-q sm-swot-' + q.toLowerCase());
      d.appendChild(h('h4', null, q));
      const ul = h('ul');
      if (!items.length) ul.appendChild(h('li', null, 'Nothing flagged by the current data.'));
      items.forEach((it) => { const li = h('li', null, it.text + ' '); li.appendChild(h('span', 'sm-src', '(' + it.src + ')')); ul.appendChild(li); });
      d.appendChild(ul); box.appendChild(d);
    });
    el.appendChild(box);
  });
  dash.draw('sp_matrix', (el) => {
    if (pending(el, ['sp_counties'])) return;
    const order = { 'Retain & expand': 0, 'Build on wins': 1, 'Market the workforce': 2, 'Prepare sites & product': 3 };
    const rows = rowsOf('sp_counties').slice().sort((a, b) => order[a.focus] - order[b.focus] || (b.warn_workers - a.warn_workers) || ((a.mfg_chg_pct ?? 0) - (b.mfg_chg_pct ?? 0)));
    const t = h('table', 'sm-table sm-sp-table');
    const hr = h('tr');
    ['County', 'Focus', 'Why', 'Suggested first move', 'Tier', 'Unemp.', 'Factory jobs, 1 yr', 'Mfg LQ', 'WARN workers', 'Announced jobs'].forEach((x) => hr.appendChild(h('th', null, x)));
    const th = h('thead'); th.appendChild(hr); t.appendChild(th);
    const tb = h('tbody');
    rows.forEach((r) => {
      const tr = h('tr');
      tr.style.cursor = 'pointer';
      tr.title = 'Open the ' + r.county + ' County profile';
      tr.addEventListener('click', () => openCounty(r.county));
      const td = (v, cls) => { const c = h('td', cls || null, v == null || v === '' ? '—' : String(v)); tr.appendChild(c); return c; };
      td(r.county);
      const fc = h('td'); const pill = h('span', 'sm-pill' + (r.focus === 'Retain & expand' ? ' late' : r.focus === 'Build on wins' ? ' ok' : ' soon'), r.focus); fc.appendChild(pill); tr.appendChild(fc);
      td(r.why || 'No flags', 'sm-wrap'); td(r.first_move, 'sm-wrap');
      td(r.tier_label || r.tier); td(r.rate != null ? f1(r.rate) + '%' : null); td(r.mfg_chg_pct != null ? sgn(r.mfg_chg_pct) + '%' : 'Withheld');
      td(r.mfg_lq != null ? f2(r.mfg_lq) : 'Withheld'); td(r.warn_workers ? int(r.warn_workers) : '0'); td(r.proj_jobs ? int(r.proj_jobs) : '0');
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    el.replaceChildren(t);
  });
  dash.draw('sp_bre', (el) => {
    if (pending(el, ['sp_counties'])) return;
    const rows = rowsOf('sp_counties').filter((r) => r.f_retention).sort((a, b) => (b.warn_workers - a.warn_workers) || ((a.mfg_chg_pct ?? 0) - (b.mfg_chg_pct ?? 0)));
    const emp = (rowsOf('sp_employers') || []).filter((e) => e.shown);
    const top = (c) => emp.filter((e) => e.county === c).sort((a, b) => (b.employees ?? -1) - (a.employees ?? -1)).slice(0, 3)
      .map((e) => e.company + (e.employees != null ? ' (' + int(e.employees) + ')' : '')).join('; ');
    miniTable(el, ['County', 'Largest disclosed manufacturing subsectors (jobs)', 'Largest listed employers', 'Factory jobs vs yr ago', 'WARN notices (24 months)'],
      rows.map((r) => [r.county, r.top_subsectors || 'Withheld by BLS', top(r.county) || 'None listed yet', r.mfg_chg_pct != null ? sgn(r.mfg_chg_pct) + '% (' + sgnInt(r.mfg_chg) + ')' : '—', r.warn_list || 'None']));
    el.querySelectorAll('td:nth-child(2), td:nth-child(3), td:nth-child(5)').forEach((c) => c.classList.add('sm-wrap'));
  });
  dash.draw('sp_employers_tbl', (el) => {
    if (pending(el, ['sp_employers'])) return;
    el.replaceChildren();
    const all = rowsOf('sp_employers'), shown = all.filter((e) => e.shown);
    const waiting = all.filter((e) => !e.shown);
    const byC = {};
    waiting.forEach((e) => { byC[e.county] = (byC[e.county] || 0) + 1; });
    el.appendChild(h('p', 'sm-note', shown.length + ' employer' + (shown.length === 1 ? '' : 's') + ' listed. ' + (waiting.length ? waiting.length + ' more in the Sheet are waiting for a web source (' + Object.entries(byC).sort((a, b) => b[1] - a[1]).map(([c, n]) => c + ' ' + n).join(', ') + ').' : 'Every Sheet row has a source.')));
    if (!shown.length) return;
    const box = h('div', 'sm-tablebox'), t = h('table', 'sm-table'), hr = h('tr');
    ['County', 'Company', 'Industry', 'Employees', 'Status', 'Source'].forEach((x) => hr.appendChild(h('th', null, x)));
    const th = h('thead'); th.appendChild(hr); t.appendChild(th);
    const tb = h('tbody');
    shown.sort((a, b) => a.county.localeCompare(b.county) || ((b.employees ?? -1) - (a.employees ?? -1))).forEach((e) => {
      const tr = h('tr');
      tr.appendChild(h('td', null, e.county)); tr.appendChild(h('td', 'sm-wrap', e.company)); tr.appendChild(h('td', 'sm-wrap', e.industry || '—'));
      tr.appendChild(h('td', null, e.employees != null ? int(e.employees) : (e.employees_note || '—')));
      tr.appendChild(h('td', 'sm-wrap', e.status));
      const s = h('td'); if (e.source_url) s.appendChild(link(e.source_url, 'Source ↗')); else s.textContent = '—'; tr.appendChild(s);
      tb.appendChild(tr);
    });
    t.appendChild(tb); box.appendChild(t); el.appendChild(box);
  });
  dash.draw('sp_clusters_tbl', (el) => {
    if (pending(el, ['sp_clusters'])) return;
    miniTable(el, ['Cluster', 'Jobs', 'Counties', 'Largest in', 'Avg weekly pay'], rowsOf('sp_clusters').slice(0, 8).map((r) => [r.subsector, int(r.jobs), r.counties, r.largest, r.wage_wk != null ? usd(r.wage_wk) : '—']));
  });
  dash.draw('sp_wins', (el) => {
    el.replaceChildren();
    const f = spF(), pr = rowsOf('projects');
    if (!pr || !f) return;
    pr.filter((r) => String(r.announced || '') >= f.window_start).sort((a, b) => (a.announced < b.announced ? 1 : -1)).forEach((r) => {
      const li = h('li', 'sm-item'), top = h('div', 'sm-item-top'), tt = h('span', 'sm-item-title');
      if (r.source_url) tt.appendChild(link(r.source_url, r.project + ' ↗')); else tt.textContent = r.project;
      top.appendChild(tt); top.appendChild(h('span', 'sm-item-meta', r.county + ' · ' + dayFmt(r.announced)));
      li.appendChild(top);
      li.appendChild(h('p', null, [r.sector, r.jobs != null ? int(r.jobs) + ' jobs' : 'jobs not stated', r.investment_m != null ? '$' + f1(r.investment_m) + 'M' : 'investment not stated'].join(' · ')));
      el.appendChild(li);
    });
  });
  function spPlanSteps() {
    const f = spF(), sp = rowsOf('sp_counties'), cl = rowsOf('sp_clusters');
    if (!f || !sp || !cl) return null;
    const ret = sp.filter((r) => r.f_retention).map((r) => r.county);
    const warn12 = (rowsOf('warn') || []).filter((r) => String(r.notice_date || '') >= todayStr().replace(/^(\d{4})/, (y) => String(Number(y) - 1)));
    const mom = sp.filter((r) => r.f_momentum).map((r) => r.county);
    const wf = sp.filter((r) => r.f_workforce_gap).map((r) => r.county);
    const prep = sp.filter((r) => r.focus === 'Prepare sites & product' || r.focus === 'Market the workforce').map((r) => r.county);
    const prog = (rowsOf('programs') || []).filter((r) => r.deadline && r.deadline >= todayStr() && daysUntil(r.deadline) <= 75).sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
    const steps = [];
    const S = (days, phase, title, text) => steps.push({ days, phase, title, text });
    if (warn12.length) S(30, 'Days 1–30', 'Follow up on recent layoffs and closures', 'Check in with the companies and county partners behind ' + spList(warn12.map((r) => r.company + ' (' + r.county + ')')) + '. Make sure affected workers are connected with the state\'s Rapid Response team (TDLWD Dislocated Worker Unit), and ask about re-use of any vacated building.');
    if (prog.length) S(30, 'Days 1–30', 'Act on funding deadlines', 'Due soon: ' + spList(prog.map((r) => r.program + ' (' + dayFmt(r.deadline) + ')')) + '. Confirm which counties have a site or project ready to apply.');
    if (ret.length) S(30, 'Days 1–30', 'Set the retention visit list', 'For ' + spList(ret) + ', list the 5 to 10 largest manufacturers, starting with the subsectors in the watch list above, and schedule visits with county partners.');
    if (ret.length) S(90, 'Days 31–90', 'Complete retention and expansion visits', 'Visit the listed employers. Record expansion plans, hiring needs, supply-chain gaps, utility or site constraints and any at-risk lines. Flag expansion leads to TNECD project managers.');
    if (cl.length) S(90, 'Days 31–90', 'Map supplier gaps in the top clusters', 'Ask employers in ' + spList(cl.slice(0, 3).map((r) => r.subsector.toLowerCase())) + ' which parts and services they buy from outside the region; those suppliers become recruitment targets.');
    if (wf.length) S(90, 'Days 31–90', 'Close workforce gaps', 'In ' + spList(wf) + ', where labor force participation and bachelor\'s attainment trail Tennessee, meet the TCATs, community colleges and school systems to match training to the needs heard on visits.');
    if (mom.length) S(180, 'Months 4–6', 'Build on recent wins', 'In ' + spList(mom) + ', use the announced projects to recruit their suppliers and service firms, and line up the hiring pipeline for the announced jobs.');
    if (prep.length) S(180, 'Months 4–6', 'Get product ready to market', 'For ' + spList(prep) + ', confirm the top industrial site\'s due diligence, utilities and broadband (County profiles tab) and pursue site-development programs where gaps remain.');
    S(365, 'Months 7–12', 'Measure and report results', 'Review the measures below every quarter (the data refreshes automatically) and share progress with county partners and TNECD.');
    return steps.map((s) => ({ ...s, due: spDue(s.days), due_label: spDate(s.days) }));
  }
  dash.draw('sp_plan', (el) => {
    el.replaceChildren();
    const steps = spPlanSteps();
    if (!steps) { el.classList.toggle('dash-skeleton', ['sp_facts', 'sp_counties', 'sp_clusters'].some((id) => dash.data(id).status === 'loading')); return; }
    el.classList.remove('dash-skeleton');
    steps.forEach((s, i) => {
      const li = h('li', 'sm-item'), top = h('div', 'sm-item-top');
      top.appendChild(h('span', 'sm-item-title', (i + 1) + '. ' + s.title));
      const due = spDue(s.days), left = daysUntil(due);
      const st = left < 0 ? ' · past due' : left <= 14 ? ' · ' + left + ' day' + (left === 1 ? '' : 's') + ' left' : '';
      top.appendChild(h('span', 'sm-pill' + (left < 0 ? ' late' : left <= 14 ? ' soon' : ''), s.phase + ' · due ' + spDate(s.days) + st));
      li.appendChild(top); li.appendChild(h('p', null, s.text)); el.appendChild(li);
    });
  });
  function spMeasureRows() {
    const f = spF(), sp = rowsOf('sp_counties');
    if (!f || !sp) return null;
    const bb = sp.filter((r) => r.broadband_pct != null).sort((a, b) => a.broadband_pct - b.broadband_pct)[0];
    return [
      ['Region manufacturing jobs', f.mfg_jobs != null ? int(f.mfg_jobs) : '—', f.quarter, 'Return to growth'],
      ['Counties losing factory jobs', f.mfg_down + ' of ' + f.mfg_reporting, f.quarter, 'Fewer each year'],
      ['Region unemployment', f.rate != null ? f1(f.rate) + '%' : '—', f.month, 'At or below Tennessee'],
      ['Private business locations', int(f.estabs), f.quarter, 'Keep growing'],
      ['Workers in WARN notices (12 months)', int(f.warn_workers_12), 'Rolling', 'Fewer'],
      ['Jobs in announced projects (24 months)', int(f.proj_jobs), 'Rolling', 'More, in more counties'],
      ['Counties with an announced project (24 months)', f.proj_counties + ' of 13', 'Rolling', 'More counties'],
      ['Lowest county home broadband', bb ? bb.county + ' ' + f1(bb.broadband_pct) + '%' : '—', 'ACS 5-year', 'Close the gap with Tennessee'],
    ];
  }
  dash.draw('sp_measures', (el) => {
    if (pending(el, ['sp_facts', 'sp_counties'])) return;
    miniTable(el, ['Measure', 'Now', 'As of', 'Goal'], spMeasureRows());
  });
  dash.draw('sp_funding', (el) => {
    el.replaceChildren();
    const p = rowsOf('programs');
    if (!p) return;
    p.filter((r) => ['Sites & infrastructure', 'Workforce', 'Energy & utilities'].includes(r.topic) && (!r.deadline || r.deadline >= todayStr()))
      .sort((a, b) => (a.deadline || '9999') < (b.deadline || '9999') ? -1 : 1)
      .forEach((r) => {
        const li = h('li', 'sm-item'), top = h('div', 'sm-item-top'), tt = h('span', 'sm-item-title');
        if (r.source_url) tt.appendChild(link(r.source_url, r.program + ' ↗')); else tt.textContent = r.program;
        top.appendChild(tt); top.appendChild(h('span', 'sm-pill' + (r.deadline && daysUntil(r.deadline) <= 30 ? ' soon' : ''), r.deadline ? 'Due ' + dayFmt(r.deadline) : 'No deadline listed'));
        li.appendChild(top); li.appendChild(h('p', null, [r.agency, r.topic, r.amount_label].filter(Boolean).join(' · ')));
        el.appendChild(li);
      });
  });

  dash.draw('sp_notebooks', (el) => {
    el.replaceChildren();
    const nb = rowsOf('notebooks');
    if (!nb) { el.classList.toggle('dash-skeleton', dash.data('notebooks').status === 'loading'); return; }
    el.classList.remove('dash-skeleton');
    nb.slice().sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).forEach((r) => {
      const li = h('li', 'sm-item'), top = h('div', 'sm-item-top'), tt = h('span', 'sm-item-title');
      tt.appendChild(link(r.url, r.name + ' ↗'));
      top.appendChild(tt); top.appendChild(h('span', 'sm-pill', r.scope || 'Notebook'));
      li.appendChild(top);
      if (r.note) li.appendChild(h('p', null, r.note));
      el.appendChild(li);
    });
  });
  dash.draw('sp_nb_counties', (el) => {
    el.replaceChildren();
    const c = rowsOf('counties');
    if (!c) return;
    el.appendChild(h('span', 'sm-note', 'County notebooks: '));
    c.filter((r) => r.notebook_url).forEach((r) => el.appendChild(link(r.notebook_url, r.county + ' ↗')));
  });
  /* markets & macro */
  const mkRows = (kind) => { const r = rowsOf('markets_tape'); return r ? r.filter((x) => x.kind === kind).sort((a, b) => a.order - b.order) : null; };
  const mkFind = (label) => { const r = mkRows('tape'); return r ? r.find((x) => x.label === label) : null; };
  const bp = (pts) => (pts == null ? '—' : sgnInt(pts * 100) + ' bp');
  const pctChg = (v) => (v == null ? '—' : sgn(v) + '%');
  const mkChg = (r, k) => {
    const v = r[k];
    if (v == null) return '—';
    if (r.chg_unit === 'pts') return bp(v);
    if (r.chg_unit === 'bp') return sgnInt(v) + ' bp';
    if (r.chg_unit === '%') return pctChg(v);
    return sgn(v, Math.abs(v) >= 100 ? 0 : 2);
  };
  const mkVal = (r) => {
    if (r.chg_unit === 'pts') return f2(r.value) + '%';
    if (r.chg_unit === 'bp') return sgnInt(r.value) + ' bp';
    if (r.group === 'FX') return r.value >= 50 ? f1(r.value) : d3.format(',.4f')(r.value);
    if (r.group === 'Equities') return int(r.value);
    return f2(r.value);
  };
  function miniTable(el, head, rows) {
    el.replaceChildren();
    const t = h('table', 'sm-table');
    const th = h('thead'), hr = h('tr');
    head.forEach((x) => hr.appendChild(h('th', null, x)));
    th.appendChild(hr); t.appendChild(th);
    const tb = h('tbody');
    rows.forEach((r) => {
      const tr = h('tr');
      r.forEach((c) => { const td = h('td', null, c == null || c === '' ? '—' : String(c)); tr.appendChild(td); });
      tb.appendChild(tr);
    });
    t.appendChild(tb); el.appendChild(t);
  }
  const mkAsOf = () => { const r = mkFind('10-year'); return r ? r.as_of : null; };
  const mkLabel = (label, d) => (d && d !== mkAsOf() ? label + ' (' + parseDay(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) + ')' : label);
  dash.draw('mk_asof', (el) => {
    const r = mkFind('10-year');
    el.textContent = r && r.as_of ? 'Market tape as of the ' + dayFmt(r.as_of) + ' close (EconVitals). Weekly and monthly series show their own dates.' : '';
  });
  dash.draw('mk_kpis', (el) => {
    el.replaceChildren();
    const tape = mkRows('tape'), fed = mkRows('fed');
    if (!tape) { el.classList.toggle('dash-skeleton', dash.data('markets_tape').status === 'loading'); return; }
    el.classList.remove('dash-skeleton');
    const tile = (label, value, sub, title) => {
      const k = h('div', 'sm-kpi');
      k.appendChild(h('span', 'sm-kpi-label', label));
      k.appendChild(h('span', 'sm-kpi-value', value ?? '—'));
      k.appendChild(h('span', 'sm-kpi-sub', sub || ''));
      if (title) k.title = title;
      el.appendChild(k);
    };
    const f = fed && fed[0];
    if (f) tile('Fed funds target', f.display, f.next_meeting && f.next_prob != null ? 'Futures: ' + f.next_prob + '% odds of ' + String(f.next_outcome).toLowerCase() + ' at the ' + dayFmt(f.next_meeting) + ' meeting' : 'As of ' + dayFmt(f.as_of), f.odds_source ? 'Odds: ' + f.odds_source + ', via EconVitals' : null);
    const t10 = mkFind('10-year'), t30 = mkFind('30-year');
    if (t10) tile('10-year Treasury', f2(t10.value) + '%', bp(t10.chg_ytd) + ' this year' + (t30 ? ' · 30-year ' + f2(t30.value) + '%' : ''), 'As of ' + dayFmt(t10.as_of));
    const sl = mkFind('2s10s slope');
    if (sl) tile('2-to-10-year slope', sgnInt(sl.value) + ' bp', (sl.value > 0 ? 'Positive (not inverted)' : sl.value < 0 ? 'Inverted' : 'Flat') + (sl.chg_ytd != null ? ' · ' + sgnInt(sl.chg_ytd) + ' bp this year' : ''), '10-year yield minus 2-year yield, as of ' + dayFmt(sl.as_of));
    const sp = mkFind('S&P 500');
    if (sp) tile('S&P 500', int(sp.value), (sp.chg_ytd != null && sp.value - sp.chg_ytd ? pctChg(sp.chg_ytd / (sp.value - sp.chg_ytd) * 100) + ' this year · ' : '') + dayFmt(sp.as_of));
    const br = tape.find((r) => r.label.startsWith('Brent'));
    if (br) tile('Brent crude', '$' + f2(br.value), pctChg(br.chg_ytd) + ' this year · ' + pctChg(br.chg_1w) + ' in a week', 'Front-month futures, $ per barrel, as of ' + dayFmt(br.as_of));
    const dx = mkFind('Dollar (DXY)'), nf = mkFind('NFCI');
    if (dx) tile('U.S. dollar index (DXY)', f1(dx.value), pctChg(dx.chg_ytd) + ' this year' + (nf ? ' · NFCI ' + sgn(nf.value, 2) : ''), 'NFCI is the Chicago Fed National Financial Conditions Index; below zero means looser-than-average conditions.');
  });
  dash.draw('mk_rates_tbl', (el) => {
    if (pending(el, ['markets_tape'])) return;
    const tape = mkRows('tape').filter((r) => ['Rates', 'Inflation-priced', 'Credit & risk'].includes(r.group));
    const rows = tape.map((r) => [mkLabel(r.label.replace('2s10s slope', '2-to-10-year slope').replace('Real 10y', 'Real 10-year (TIPS)').replace('10y breakeven', '10-year breakeven inflation').replace('5y5y fwd breakeven', '5y5y forward breakeven'), r.as_of), mkVal(r), mkChg(r, 'chg_1w'), mkChg(r, 'chg_ytd')]);
    const sp = rowsOf('mk_spreads');
    if (sp) sp.forEach((r) => rows.push([mkLabel(r.label, r.as_of), r.value == null ? '—' : int(r.value * 100) + ' bp', bp(r.chg_1w), bp(r.chg_ytd)]));
    miniTable(el, ['Measure', 'Latest', '1 week', 'This year'], rows);
  });
  dash.draw('mk_infl_tbl', (el) => {
    if (pending(el, ['markets_tape'])) return;
    miniTable(el, ['Measure', '12 months', '3 months (annual rate)', 'Through'], mkRows('inflation').map((r) => [r.label, r.yoy == null ? '—' : f1(r.yoy) + '%', r.ann_3 == null ? '—' : f1(r.ann_3) + '%', r.as_of]));
  });
  const mkSeries = (id, name, days) => {
    const rows = (rowsOf(id) || []).filter((r) => r.value != null).sort((a, b) => (a.date < b.date ? -1 : 1));
    const last = rows.length ? parseDay(rows[rows.length - 1].date) : null;
    return { name, values: rows.filter((r) => !days || !last || (last - parseDay(r.date)) / 864e5 <= days).map((r) => ({ date: parseDay(r.date), value: r.value })) };
  };
  dash.draw('mk_yields_chart', (el) => {
    if (pending(el, ['mk_dgs2', 'mk_dgs10', 'mk_dgs30'])) return;
    lineChart(el, [mkSeries('mk_dgs2', '2-yr', 366), mkSeries('mk_dgs10', '10-yr', 366), mkSeries('mk_dgs30', '30-yr', 366)].map((s, i) => ({ ...s, color: dash.colors[i] })),
      { fmt: (v) => f2(v) + '%', yfmt: (v) => f1(v) + '%', tipfmt: '%b %d, %Y', aria: 'Treasury yields over the past year' });
  });
  dash.draw('mk_oas_chart', (el) => {
    if (pending(el, ['mk_ig', 'mk_hy'])) return;
    lineChart(el, [mkSeries('mk_ig', 'Investment grade', 366), mkSeries('mk_hy', 'High yield', 366)].map((s, i) => ({ ...s, color: dash.colors[i] })),
      { fmt: (v) => f2(v), yfmt: (v) => f1(v), tipfmt: '%b %d, %Y', zero: true, aria: 'Corporate bond spreads over the past year' });
  });
  dash.draw('mk_fiscal_tbl', (el) => {
    if (pending(el, ['mk_fiscal'])) return;
    const fr = rowsOf('mk_fiscal'), span = (fr.find((r) => r.avg_label) || {}).avg_label;
    miniTable(el, ['Share of GDP', 'Latest', 'Period', span ? 'Average ' + span : '60-year average', 'Difference'], fr.map((r) => [r.measure, f1(r.latest) + '%', r.period, r.avg == null ? '—' : f1(r.avg) + '%', r.diff == null ? '—' : sgn(r.diff) + ' pts']));
  });
  dash.draw('mk_deficit_chart', (el) => {
    if (pending(el, ['mk_fiscal', 'mk_deficit'])) return;
    const s = mkSeries('mk_deficit', 'Surplus/deficit');
    const avgRow = rowsOf('mk_fiscal').find((r) => r.measure.startsWith('Surplus'));
    const vals = s.values.slice(-60);
    const series = [{ name: 'Surplus/deficit', values: vals, color: dash.colors[0] }];
    if (avgRow && vals.length) series.push({ name: '60-yr avg', values: vals.map((v) => ({ date: v.date, value: avgRow.avg })), color: 'var(--cds-chart-reference)', dashed: true, width: 1.5 });
    lineChart(el, series, { fmt: (v) => f1(v) + '%', yfmt: (v) => f1(v) + '%', xfmt: '%Y', tipfmt: 'FY%Y', aria: 'Federal surplus or deficit as a share of GDP' });
  });
  dash.draw('mk_intl_tbl', (el) => {
    if (pending(el, ['markets_tape'])) return;
    const p = (v) => (v == null ? '—' : f2(v) + '%'), q = (v) => (v == null ? '—' : f1(v) + '%');
    miniTable(el, ['Economy', 'Policy rate', '10-year', 'Inflation', 'Unemployment', 'GDP (4 qtrs)', 'As of'], mkRows('intl').map((r) => [r.label, p(r.pol), p(r.ten), q(r.cpi), q(r.unemp), q(r.gdp), r.as_of]));
  });
  dash.draw('mk_fx_tbl', (el) => {
    if (pending(el, ['markets_tape'])) return;
    miniTable(el, ['Item', 'Latest', '1 week', 'This year'], mkRows('tape').filter((r) => r.group === 'FX' || r.group === 'Commodities')
      .map((r) => [mkLabel(r.label, r.as_of), mkVal(r), mkChg(r, 'chg_1w'), mkChg(r, 'chg_ytd')]));
  });

  /* education */
  dash.draw('ed_bach', (el) => {
    if (pending(el, ['edu_county'])) return;
    hbars(el, rowsOf('edu_county').filter((r) => r.bach_pct != null).sort((a, b) => b.bach_pct - a.bach_pct)
      .map((r) => ({ label: r.county, value: r.bach_pct, text: f1(r.bach_pct) + '%', county: r.county })), { onClick: (r) => openCounty(r.county) });
  });
  const linkList = (el, rows) => rows.forEach((r) => {
    const li = h('li', 'sm-item');
    const top = h('div', 'sm-item-top');
    const t = h('span', 'sm-item-title');
    if (r.url) t.appendChild(link(r.url, r.name + ' ↗')); else t.textContent = r.name;
    top.appendChild(t);
    if (r.where) top.appendChild(h('span', 'sm-item-meta', r.where));
    li.appendChild(top);
    if (r.description) li.appendChild(h('p', null, r.description));
    el.appendChild(li);
  });
  const resDraw = (name, cat) => dash.draw(name, (el) => { el.replaceChildren(); const rows = rowsOf('resources'); if (rows) linkList(el, rows.filter((r) => r.category === cat)); });
  resDraw('ed_training', 'Training');
  resDraw('tr_attr', 'Attractions');
  resDraw('ag_links', 'Agriculture');
  const programItem = (r) => {
    const li = h('li', 'sm-item');
    const top = h('div', 'sm-item-top');
    top.appendChild(h('span', 'sm-item-title', r.program));
    top.appendChild(h('span', 'sm-pill', r.agency));
    li.appendChild(top);
    li.appendChild(h('span', 'sm-item-meta', (r.amount_label || '') + (r.deadline ? ' · Deadline ' + dayFmt(r.deadline) : '')));
    const det = h('details');
    det.appendChild(h('summary', null, 'Read more'));
    det.appendChild(h('p', null, r.summary));
    if (r.who) det.appendChild(h('p', null, 'Who: ' + r.who));
    if (r.source_url) { const p = h('p'); p.appendChild(link(r.source_url, 'Source ↗')); det.appendChild(p); }
    li.appendChild(det);
    return li;
  };
  dash.draw('ed_programs', (el) => { el.replaceChildren(); const rows = rowsOf('programs'); if (rows) rows.filter((r) => r.topic === 'Workforce').forEach((r) => el.appendChild(programItem(r))); });

  /* manufacturing */
  valueDraw('m_jobs', f1); valueDraw('m_jobs_chg', (v) => sgn(v), { goodIf: (v) => v > 0 });
  valueDraw('m_inv', f2); valueDraw('m_jobs_ann', int);
  valueDraw('m_wage_m', str); valueDraw('m_wage', f2); valueDraw('m_wage_chg', (v) => sgn(v), { goodIf: (v) => v > 0 });
  valueDraw('m_nash', f1); valueDraw('m_nash_chg', (v) => sgn(v), { goodIf: (v) => v > 0 });
  valueDraw('m_us', f2); valueDraw('m_us_chg', sgnInt, { goodIf: (v) => v > 0 });
  dash.draw('m_growth_bars', (el) => {
    if (pending(el, ['mfg_growth'])) return;
    hbars(el, rowsOf('mfg_growth').filter((r) => r.chg_pct != null).map((r) => ({ label: r.area, value: r.chg_pct, text: sgn(r.chg_pct) + '%', tip: sgn(r.chg_pct) + '% in the 12 months to ' + r.month })), { aria: 'Manufacturing job growth comparison' });
  });
  const seriesDraw = (name, id, label) => dash.draw(name, (el) => {
    if (pending(el, [id])) return;
    lineChart(el, [{ name: label, values: rowsOf(id).slice().sort((a, b) => (a.date < b.date ? -1 : 1)).map((r) => ({ date: parseDay(r.date), value: r.value })), color: dash.colors[0] }], { fmt: (v) => f1(v) + 'K', yfmt: (v) => int(v) + 'K' });
  });
  seriesDraw('m_trend', 'tn_mfg', 'TN');
  seriesDraw('tr_trend', 'tn_leih', 'TN');
  seriesDraw('m_nash_trend', 'nash_mfg', 'Nashville');
  const projBars = (name, filter) => dash.draw(name, (el) => {
    if (pending(el, ['projects'])) return;
    hbars(el, rowsOf('projects').filter(filter).sort((a, b) => b.investment_m - a.investment_m)
      .map((r) => ({ label: r.project, value: r.investment_m, text: r.investment_label, tip: r.county + ' · ' + r.jobs_label })), { fmt: (v) => '$' + f1(v) + 'M' });
  });
  projBars('m_inv_bars', (r) => r.category === 'Manufacturing');
  projBars('g_inv_bars', () => true);
  dash.draw('m_anchors', (el) => {
    el.replaceChildren();
    const rows = rowsOf('counties');
    if (!rows) return;
    rows.forEach((r) => {
      const li = h('li', 'sm-item');
      const top = h('div', 'sm-item-top');
      top.appendChild(h('span', 'sm-item-title', r.county));
      top.appendChild(verifiedPill(r));
      li.appendChild(top);
      const items = String(r.anchors || '').split(';').map((s) => s.trim()).filter(Boolean);
      li.appendChild(h('p', null, items.slice(0, 2).join(' · ') || '—'));
      if (items.length > 2) {
        const det = h('details');
        det.appendChild(h('summary', null, 'Read more (' + (items.length - 2) + ' more)'));
        const ul = h('ul');
        items.slice(2).forEach((s) => ul.appendChild(h('li', null, s)));
        det.appendChild(ul);
        li.appendChild(det);
      }
      el.appendChild(li);
    });
  });

  /* county manufacturing (QCEW) */
  valueDraw('m_q', str); valueDraw('m_reg_jobs', int); valueDraw('m_reg_chg', sgnInt, { goodIf: (v) => v > 0 }); valueDraw('m_reg_chg_pct', (v) => sgn(v), { goodIf: (v) => v > 0 });
  valueDraw('m_reg_share', f1); valueDraw('m_tn_share', f1); valueDraw('m_reg_estabs', int); valueDraw('m_tn_wage', int);
  const mfgRows = () => { const r = rowsOf('mfg_county'); return r ? r.filter((x) => COUNTIES.includes(x.county)) : null; };
  const mfgTN = () => (rowsOf('mfg_county') || []).find((x) => x.county === 'Tennessee');
  dash.draw('m_cty_jobs', (el) => {
    if (pending(el, ['mfg_county'])) return;
    hbars(el, mfgRows().filter((r) => r.mfg_jobs != null).sort((a, b) => b.mfg_jobs - a.mfg_jobs)
      .map((r) => ({ label: r.county, value: r.mfg_jobs, text: int(r.mfg_jobs) + (r.mfg_jobs_chg == null ? '' : ' (' + sgnInt(r.mfg_jobs_chg) + ')'), county: r.county, tip: int(r.mfg_jobs) + ' jobs at ' + int(r.mfg_estabs) + ' plants, ' + r.quarter })), { onClick: (r) => openCounty(r.county), aria: 'Manufacturing jobs by county' });
  });
  dash.draw('m_cty_chg', (el) => {
    if (pending(el, ['mfg_county'])) return;
    const tn = mfgTN();
    hbars(el, mfgRows().filter((r) => r.mfg_jobs_chg_pct != null).sort((a, b) => b.mfg_jobs_chg_pct - a.mfg_jobs_chg_pct)
      .map((r) => ({ label: r.county, value: r.mfg_jobs_chg_pct, text: sgn(r.mfg_jobs_chg_pct) + '%', county: r.county, tip: sgnInt(r.mfg_jobs_chg) + ' jobs' })),
    { ref: tn && tn.mfg_jobs_chg_pct != null ? { value: tn.mfg_jobs_chg_pct, label: 'TN ' + sgn(tn.mfg_jobs_chg_pct) + '%' } : null, onClick: (r) => openCounty(r.county), aria: 'Change in manufacturing jobs by county' });
  });
  dash.draw('m_cty_lq', (el) => {
    if (pending(el, ['mfg_county'])) return;
    hbars(el, mfgRows().filter((r) => r.mfg_lq != null).sort((a, b) => b.mfg_lq - a.mfg_lq)
      .map((r) => ({ label: r.county, value: r.mfg_lq, text: f2(r.mfg_lq), county: r.county, tip: f1(r.mfg_share_pct) + '% of private jobs are in manufacturing' })),
    { ref: { value: 1, label: 'U.S. = 1.0' }, onClick: (r) => openCounty(r.county), aria: 'Manufacturing location quotient by county' });
  });
  dash.draw('m_cty_wage', (el) => {
    if (pending(el, ['mfg_county'])) return;
    const tn = mfgTN();
    hbars(el, mfgRows().filter((r) => r.mfg_wage_wk != null).sort((a, b) => b.mfg_wage_wk - a.mfg_wage_wk)
      .map((r) => ({ label: r.county, value: r.mfg_wage_wk, text: '$' + int(r.mfg_wage_wk), county: r.county, tip: '$' + int(r.mfg_wage_wk) + ' a week' })),
    { ref: tn && tn.mfg_wage_wk != null ? { value: tn.mfg_wage_wk, label: 'TN $' + int(tn.mfg_wage_wk) } : null, onClick: (r) => openCounty(r.county), aria: 'Average weekly manufacturing pay by county' });
  });
  dash.draw('m_subsectors', (el) => {
    el.replaceChildren();
    const rows = rowsOf('qcew_subsectors');
    if (!rows) return;
    const by = d3.group(rows, (r) => r.county);
    COUNTIES.forEach((c) => {
      const items = (by.get(c) || []).slice().sort((a, b) => b.jobs - a.jobs);
      const li = h('li', 'sm-item');
      const top = h('div', 'sm-item-top');
      top.appendChild(h('span', 'sm-item-title', c));
      top.appendChild(h('span', 'sm-item-meta', items.length ? items.length + ' industries published' : 'All withheld'));
      li.appendChild(top);
      li.appendChild(h('p', null, items.length ? items.slice(0, 3).map((r) => r.subsector.replace(/ manufacturing$/i, '') + ' ' + int(r.jobs)).join(' · ') : 'BLS withholds this county’s industry detail.'));
      if (items.length > 3) {
        const det = h('details');
        det.appendChild(h('summary', null, 'Read more (' + (items.length - 3) + ' more)'));
        const ul = h('ul');
        items.slice(3).forEach((r) => ul.appendChild(h('li', null, r.subsector + ': ' + int(r.jobs) + ' jobs, ' + int(r.estabs) + ' plants, $' + int(r.wage_wk) + '/wk')));
        det.appendChild(ul);
        li.appendChild(det);
      }
      el.appendChild(li);
    });
  });

  /* agriculture (USDA Census of Agriculture) */
  valueDraw('ag_year', str); valueDraw('ag_farms', int); valueDraw('ag_farms_chg', (v) => sgn(v)); valueDraw('ag_acres', int);
  valueDraw('ag_sales', f1); valueDraw('ag_sales_chg', (v) => sgn(v), { goodIf: (v) => v > 0 }); valueDraw('ag_cattle', int);
  const agRows = () => { const r = rowsOf('ag_county'); return r ? r.filter((x) => COUNTIES.includes(x.county)) : null; };
  dash.draw('ag_sales_bars', (el) => {
    if (pending(el, ['ag_county'])) return;
    hbars(el, agRows().filter((r) => r.sales_m != null).sort((a, b) => b.sales_m - a.sales_m)
      .map((r) => ({ label: r.county, value: r.sales_m, text: '$' + f1(r.sales_m) + 'M', county: r.county, tip: 'Crops $' + f1(r.crop_m) + 'M · Livestock $' + f1(r.animal_m) + 'M' })), { onClick: (r) => openCounty(r.county), aria: 'Farm product sales by county' });
  });
  dash.draw('ag_farms_bars', (el) => {
    if (pending(el, ['ag_county'])) return;
    const tn = (rowsOf('ag_county') || []).find((x) => x.county === 'Tennessee');
    hbars(el, agRows().filter((r) => r.farms_chg_pct != null).sort((a, b) => b.farms_chg_pct - a.farms_chg_pct)
      .map((r) => ({ label: r.county, value: r.farms_chg_pct, text: sgn(r.farms_chg_pct) + '%', county: r.county, tip: int(r.farms_2017) + ' farms in 2017, ' + int(r.farms) + ' in 2022' })),
    { ref: tn && tn.farms_chg_pct != null ? { value: tn.farms_chg_pct, label: 'TN ' + sgn(tn.farms_chg_pct) + '%' } : null, onClick: (r) => openCounty(r.county), aria: 'Change in number of farms by county' });
  });
  dash.draw('ag_cattle_bars', (el) => {
    if (pending(el, ['ag_latest'])) return;
    hbars(el, rowsOf('ag_latest').filter((r) => COUNTIES.includes(r.county) && r.cattle_head != null).sort((a, b) => b.cattle_head - a.cattle_head)
      .map((r) => ({ label: r.county, value: r.cattle_head, county: r.county, text: int(r.cattle_head) + (r.cattle_chg_pct != null ? ' (' + sgn(r.cattle_chg_pct) + '%)' : '') })), { onClick: (r) => openCounty(r.county), aria: 'Cattle and calves by county' });
  });
  valueDraw('ag_cattle_asof', (v) => dayFmt(v)); valueDraw('ag_cattle_asof2', (v) => dayFmt(v)); valueDraw('ag_cattle_chg', (v) => sgn(v));
  dash.draw('ag_latest_tbl', (el) => {
    if (pending(el, ['ag_latest'])) return;
    const rows = rowsOf('ag_latest').filter((r) => r.county !== 'Region');
    const np = (r, f) => (r[f] != null ? int(r[f]) : (r.withheld || []).includes(f) ? 'Withheld' : 'Not published');
    const cy = (rows[0] || {}).crops_year, ry = (rows[0] || {}).rent_year, ca = (rows[0] || {}).cattle_as_of;
    miniTable(el, ['County', 'Cattle, ' + (ca ? dayFmt(ca) : ''), 'Change vs a year earlier', 'Beef cows', 'Corn ' + (cy || '') + ' (bu)', 'Soybeans ' + (cy || '') + ' (bu)', 'Winter wheat ' + (cy || '') + ' (bu)', 'Cash rent ' + (ry || '') + ', cropland ($/acre)', 'Cash rent ' + (ry || '') + ', pasture ($/acre)'],
      rows.map((r) => [r.county, np(r, 'cattle_head'), r.cattle_chg_pct != null ? sgn(r.cattle_chg_pct) + '%' : '—', np(r, 'beef_cows'), np(r, 'corn_bu'), np(r, 'soy_bu'), np(r, 'wheat_bu'), r.rent_crop != null ? '$' + f2(r.rent_crop) : 'Not published', r.rent_pasture != null ? '$' + f2(r.rent_pasture) : 'Not published']));
  });
  dash.draw('ag_top', (el) => {
    el.replaceChildren();
    const rows = agRows();
    if (!rows) return;
    rows.slice().sort((a, b) => (b.sales_m || 0) - (a.sales_m || 0)).forEach((r) => {
      const li = h('li', 'sm-item');
      const top = h('div', 'sm-item-top');
      top.appendChild(h('span', 'sm-item-title', r.county));
      top.appendChild(h('span', 'sm-item-meta', int(r.farms) + ' farms · avg ' + int(r.avg_farm_acres) + ' acres'));
      li.appendChild(top);
      li.appendChild(h('p', null, [[r.top1, r.top1_m], [r.top2, r.top2_m], [r.top3, r.top3_m]].filter((t) => t[0]).map((t, i) => (i + 1) + '. ' + t[0] + ' $' + f1(t[1]) + 'M').join(' · ') || '—'));
      if (r.withheld) {
        const det = h('details');
        det.appendChild(h('summary', null, 'Read more'));
        det.appendChild(h('p', null, 'Withheld by USDA for confidentiality: ' + r.withheld + '.'));
        li.appendChild(det);
      }
      el.appendChild(li);
    });
  });

  /* high school graduation */
  const pct1 = (v) => f1(v) + '%';
  valueDraw('hs_year', str); valueDraw('hs_rate', pct1); valueDraw('hs_tn', pct1); valueDraw('hs_fed', pct1); valueDraw('hs_tn_fed', pct1);
  valueDraw('hs_grads', int); valueDraw('hs_cohort', int); valueDraw('hs_econ', pct1);
  const hsRows = () => (rowsOf('grad_summary') || []).filter((r) => !r.calculated);
  const noteTxt = (v, n) => (v != null ? pct1(v) : n || 'not published');
  dash.draw('hs_dumbbell', (el) => {
    if (pending(el, ['grad_summary'])) return;
    const all = rowsOf('grad_summary');
    const rows = hsRows().filter((r) => r.rate_state != null).sort((a, b) => b.rate_state - a.rate_state);
    const hidden = hsRows().filter((r) => r.rate_state == null);
    const tn = all.find((r) => r.district === 'Tennessee');
    if (!rows.length) return;
    const leg = h('div', 'sm-legend');
    [['State version', dash.colors[0]], ['Federal version', dash.colors[1]]].forEach(([t, c]) => {
      const sw = h('span'); sw.style.cssText = 'display:inline-block;width:10px;height:10px;border-radius:50%;background:' + c; leg.appendChild(sw); leg.appendChild(h('span', null, t));
    });
    if (tn && tn.rate_state != null) leg.appendChild(h('span', null, '· Dashed line = Tennessee, state version (calculated)'));
    el.appendChild(leg);
    const W = W0(el), rowH = 24, top = 18;
    const H = top + rows.length * rowH + 22;
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'High school graduation rate by district, state and federal versions');
    const lw = Math.ceil(d3.max(rows, (r) => measure(svg, r.district, 'sm-lbl')) || 0) + 10;
    const lo = Math.floor(Math.min(d3.min(rows, (r) => Math.min(r.rate_state, r.rate_federal ?? r.rate_state)), tn ? tn.rate_federal ?? 100 : 100) / 5) * 5;
    const x = d3.scaleLinear([lo, 100], [lw, W - 44]);
    x.ticks(5).forEach((t) => {
      svg.append('line').attr('x1', x(t)).attr('x2', x(t)).attr('y1', top - 4).attr('y2', H - 20).style('stroke', 'var(--cds-chart-grid, var(--color-border-line))');
      svg.append('text').attr('class', 'sm-tick').attr('x', x(t)).attr('y', H - 6).attr('text-anchor', 'middle').text(t + '%');
    });
    const tt = tip(el);
    rows.forEach((r, i) => {
      const y = top + i * rowH + rowH / 2;
      const g = svg.append('g');
      g.append('text').attr('class', 'sm-lbl').attr('x', lw - 10).attr('y', y).attr('dy', '0.35em').attr('text-anchor', 'end').text(r.district);
      if (r.rate_federal != null) g.append('line').attr('x1', x(r.rate_federal)).attr('x2', x(r.rate_state)).attr('y1', y).attr('y2', y).style('stroke', 'var(--color-border-line)').style('stroke-width', 3);
      if (r.rate_federal != null) g.append('circle').attr('cx', x(r.rate_federal)).attr('cy', y).attr('r', 5).style('fill', dash.colors[1]);
      g.append('circle').attr('cx', x(r.rate_state)).attr('cy', y).attr('r', 5).style('fill', dash.colors[0]);
      g.append('text').attr('class', 'sm-val').attr('x', x(Math.max(r.rate_state, r.rate_federal ?? 0)) + 9).attr('y', y).attr('dy', '0.35em').text(pct1(r.rate_state));
      g.append('rect').attr('x', 0).attr('y', y - rowH / 2).attr('width', W).attr('height', rowH).style('fill', 'transparent')
        .on('mousemove', (ev) => tt.show(ev, [r.district + ' · ' + r.county + ' County',
          'State version ' + pct1(r.rate_state) + ' · federal ' + noteTxt(r.rate_federal, r.note),
          int(r.grads_state) + ' graduates of ' + int(r.cohort) + ' students in the class',
          'Economically disadvantaged: ' + noteTxt(r.econ_rate_state, r.econ_note),
          'Students with disabilities: ' + noteTxt(r.swd_rate_state, r.swd_note)]))
        .on('mouseleave', () => tt.hide());
    });
    if (tn && tn.rate_state != null) {
      const xr = x(tn.rate_state);
      svg.append('line').attr('x1', xr).attr('x2', xr).attr('y1', top - 6).attr('y2', H - 20).style('stroke', 'var(--cds-chart-reference)').attr('stroke-dasharray', '4 3');
      svg.append('text').attr('class', 'sm-tick').attr('x', xr).attr('y', 10).attr('text-anchor', 'middle').text('TN ' + pct1(tn.rate_state));
    }
    if (hidden.length) el.appendChild(h('p', 'sm-note', hidden.map((r) => r.district + ': ' + (r.note || 'not published') + ' in the class, so TDOE does not publish a rate.').join(' ')));
  });
  dash.draw('hs_grads_bars', (el) => {
    if (pending(el, ['grad_summary'])) return;
    hbars(el, hsRows().filter((r) => r.grads_state != null).sort((a, b) => b.grads_state - a.grads_state)
      .map((r) => ({ label: r.district, value: r.grads_state, tip: int(r.grads_state) + ' graduates of ' + int(r.cohort) + ' students in the class (state version)' })), { aria: 'High school graduates by district' });
  });

  /* news: stories of interest + AI Frontier Radar sheet */
  const NEWS_CATS = ['ECD & Workforce', 'Industry & Infrastructure', 'Economy & Markets', 'AI & Agent Tech', 'Health & Longevity', 'Non-Obvious Trends'];
  let newsCat = 'All';
  document.querySelectorAll('#nw-filter button').forEach((b) => b.addEventListener('click', () => {
    newsCat = b.dataset.cat;
    document.querySelectorAll('#nw-filter button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    dash.draw('nw_stories');
  }));
  const newsDate = (s) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return dayFmt(s);
    if (/^\d{4}-\d{2}$/.test(String(s))) return new Date(s + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    return String(s || '');
  };
  const byDateDesc = (a, b) => (String(a.date) < String(b.date) ? 1 : String(a.date) > String(b.date) ? -1 : 0);
  const catPill = (label, i) => { const p = h('span', 'sm-pill', label); if (i >= 0) { p.style.color = dash.colors[i % dash.colors.length]; p.style.borderColor = 'currentColor'; } return p; };
  dash.draw('nw_stories', (el) => {
    el.replaceChildren();
    const rows = rowsOf('stories');
    if (!rows) return;
    const list = rows.filter((r) => newsCat === 'All' || r.category === newsCat).sort(byDateDesc);
    if (!list.length) { el.appendChild(h('li', 'sm-note', 'No stories in this category yet.')); return; }
    list.forEach((r) => {
      const li = h('li', 'sm-story');
      const top = h('div', 'sm-item-top');
      top.appendChild(catPill(r.category, NEWS_CATS.indexOf(r.category)));
      top.appendChild(h('span', 'sm-item-meta', newsDate(r.date)));
      li.appendChild(top);
      const t = h('div', 'sm-story-title');
      t.appendChild(r.source_url ? link(r.source_url, r.headline + ' ↗') : document.createTextNode(r.headline));
      li.appendChild(t);
      if (r.publisher) li.appendChild(h('span', 'sm-item-meta', r.publisher));
      if (r.summary) li.appendChild(h('p', null, r.summary));
      if (r.why_it_matters) {
        const w = h('div', 'sm-why');
        w.appendChild(h('strong', null, 'Why it matters: '));
        w.appendChild(document.createTextNode(r.why_it_matters));
        li.appendChild(w);
      }
      el.appendChild(li);
    });
  });
  dash.draw('nw_radar', (el) => {
    el.replaceChildren();
    const rows = rowsOf('radar_feed');
    if (!rows) return;
    const item = (r) => {
      const li = h('li', 'sm-story');
      const top = h('div', 'sm-item-top');
      top.appendChild(catPill(r.lab || 'Radar', -1));
      top.appendChild(h('span', 'sm-item-meta', newsDate(r.date)));
      li.appendChild(top);
      const t = h('div', 'sm-story-title');
      t.appendChild(r.url ? link(r.url, r.title + ' ↗') : document.createTextNode(r.title));
      li.appendChild(t);
      if (r.impact) { const w = h('div', 'sm-why'); w.appendChild(h('strong', null, 'Impact: ')); w.appendChild(document.createTextNode(r.impact)); li.appendChild(w); }
      if (!r.url && r.source_note) li.appendChild(h('span', 'sm-item-meta', 'Source noted: ' + r.source_note));
      return li;
    };
    const list = rows.slice().sort(byDateDesc);
    list.slice(0, 12).forEach((r) => el.appendChild(item(r)));
    if (list.length > 12) {
      const li = h('li', 'sm-story-more');
      const det = h('details');
      det.appendChild(h('summary', null, 'Show ' + (list.length - 12) + ' older entries'));
      const ul = h('ul', 'sm-news');
      list.slice(12).forEach((r) => ul.appendChild(item(r)));
      det.appendChild(ul);
      li.appendChild(det);
      el.appendChild(li);
    }
  });

  /* colleges & TCATs */
  valueDraw('col_eyear', str); valueDraw('col_cyear', str); valueDraw('col_enr', int); valueDraw('col_enr_chg', sgnInt, { goodIf: (v) => v > 0 });
  valueDraw('col_cert', int); valueDraw('col_assoc', int); valueDraw('col_bach', int);
  const colRows = () => (rowsOf('college_summary') || []).filter((r) => r.institution !== 'All');
  dash.draw('col_enr_bars', (el) => {
    if (pending(el, ['college_summary'])) return;
    hbars(el, colRows().filter((r) => r.enroll > 0).sort((a, b) => b.enroll - a.enroll)
      .map((r) => ({ label: r.institution.replace(' Community College', ''), value: r.enroll, tip: int(r.enroll) + ' in fall ' + r.enroll_year + ' (' + sgnInt(r.enroll_chg) + ' vs ' + (r.enroll_year - 1) + ') · ' + r.city })), { aria: 'Fall enrollment by school' });
  });
  dash.draw('col_comp_bars', (el) => {
    if (pending(el, ['college_summary'])) return;
    hbars(el, colRows().filter((r) => r.total_awards > 0).sort((a, b) => b.total_awards - a.total_awards)
      .map((r) => ({ label: r.institution.replace(' Community College', ''), value: r.total_awards,
        tip: [r.certificates ? int(r.certificates) + ' certificates/diplomas' : '', r.associate ? int(r.associate) + ' associate' : '', r.bachelor ? int(r.bachelor) + " bachelor's" : '', r.graduate ? int(r.graduate) + ' graduate' : ''].filter(Boolean).join(' · ') })), { aria: 'Credentials awarded by school' });
  });
  dash.draw('col_pipeline', (el) => {
    if (pending(el, ['program_pipeline'])) return;
    hbars(el, rowsOf('program_pipeline').slice(0, 12).map((r) => ({ label: r.program, value: r.total,
      tip: int(r.certificates) + ' certificates/diplomas · ' + int(r.associate) + ' associate · ' + r.schools })), { aria: 'Regional talent pipeline by program area' });
  });
  dash.draw('col_top', (el) => {
    el.replaceChildren();
    const rows = rowsOf('edu_colleges');
    if (!rows) return;
    const cy = Math.max(...rows.filter((r) => r.kind === 'completions').map((r) => r.year));
    [...new Set(rows.map((r) => r.institution))].forEach((name) => {
      const by = new Map();
      rows.filter((r) => r.institution === name && r.kind === 'completions' && r.year === cy && r.cip2 !== 99).forEach((r) => by.set(r.program, (by.get(r.program) || 0) + r.value));
      const list = [...by.entries()].filter((e) => e[1] > 0).sort((a, b) => b[1] - a[1]);
      const first = rows.find((r) => r.institution === name);
      const li = h('li', 'sm-item');
      const top = h('div', 'sm-item-top');
      const t = h('span', 'sm-item-title');
      t.appendChild(link(first.source_url, name + ' ↗'));
      top.appendChild(t);
      top.appendChild(h('span', 'sm-item-meta', first.city + ' · ' + first.type));
      li.appendChild(top);
      li.appendChild(h('p', null, list.slice(0, 3).map((e, i) => (i + 1) + '. ' + e[0] + ' ' + int(e[1])).join(' · ') || '—'));
      if (list.length > 3) {
        const det = h('details');
        det.appendChild(h('summary', null, 'Read more (' + (list.length - 3) + ' more)'));
        const ul = h('ul');
        list.slice(3).forEach((e) => ul.appendChild(h('li', null, e[0] + ': ' + int(e[1]))));
        det.appendChild(ul);
        li.appendChild(det);
      }
      el.appendChild(li);
    });
  });

  /* BEA economy mix */
  dash.draw('e_mix_year', (el) => { const r = rowsOf('industry_mix'); el.textContent = r && r.length ? String(r[0].year) : '—'; });
  dash.draw('e_mix', (el) => {
    if (pending(el, ['industry_mix'])) return;
    const rows = rowsOf('industry_mix').filter((r) => r.order < 99);
    const groups = [...new Set(rows.sort((a, b) => a.order - b.order).map((r) => r.group))];
    const places = COUNTIES.concat(['Tennessee']).filter((c) => rows.some((r) => r.county === c));
    const mfgShare = (c) => (rows.find((r) => r.county === c && r.group === 'Manufacturing') || {}).share_pct || 0;
    places.sort((a, b) => (a === 'Tennessee') - (b === 'Tennessee') || mfgShare(b) - mfgShare(a));
    const W = W0(el), rowH = 20, gap = 6;
    const color = (g, i) => (g === 'Not disclosed' ? 'var(--cds-chart-muted)' : dash.colors[i % dash.colors.length]);
    const legendRows = Math.ceil(groups.length / Math.max(1, Math.floor(W / 190)));
    const top = legendRows * 18 + 8;
    const H = top + places.length * (rowH + gap) + 4;
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Economy mix by county, share of GDP by sector');
    const per = Math.max(1, Math.floor(W / 190));
    groups.forEach((g, i) => {
      const lx = (i % per) * 190, ly = Math.floor(i / per) * 18;
      svg.append('rect').attr('x', lx).attr('y', ly + 3).attr('width', 10).attr('height', 10).attr('rx', 2).style('fill', color(g, i));
      svg.append('text').attr('class', 'sm-tick').attr('x', lx + 14).attr('y', ly + 12).text(g);
    });
    const lw = Math.ceil(d3.max(places, (c) => measure(svg, c, 'sm-lbl'))) + 10;
    const x = d3.scaleLinear([0, 100], [lw, W - 4]);
    const tt = tip(el);
    places.forEach((c, k) => {
      const y = top + k * (rowH + gap);
      svg.append('text').attr('class', 'sm-lbl').attr('x', lw - 10).attr('y', y + rowH / 2).attr('dy', '0.35em').attr('text-anchor', 'end').style('font-weight', c === 'Tennessee' ? 600 : null).text(c);
      let acc = 0;
      groups.forEach((g, i) => {
        const r = rows.find((q) => q.county === c && q.group === g);
        const v = r ? r.share_pct : 0;
        if (!v) return;
        svg.append('rect').attr('x', x(acc)).attr('y', y).attr('width', Math.max(0, x(acc + v) - x(acc))).attr('height', rowH).style('fill', color(g, i))
          .style('stroke', 'var(--color-panel)').style('stroke-width', '1px')
          .on('mousemove', (ev) => tt.show(ev, [c + ' · ' + g, f1(v) + '% · $' + f1(r.gdp_m) + 'M']))
          .on('mouseleave', () => tt.hide())
          .on('click', COUNTIES.includes(c) ? () => openCounty(c) : null);
        if (g === 'Manufacturing' && x(acc + v) - x(acc) > 34) svg.append('text').attr('x', x(acc) + 4).attr('y', y + rowH / 2).attr('dy', '0.35em').style('font-size', '11px').style('fill', 'var(--color-bg)').style('pointer-events', 'none').text(Math.round(v) + '%');
        acc += v;
      });
    });
  });
  dash.draw('e_mfg_gdp', (el) => {
    if (pending(el, ['mfg_gdp'])) return;
    const rows = rowsOf('mfg_gdp');
    const tn = rows.find((r) => r.county === 'Tennessee');
    hbars(el, rows.filter((r) => COUNTIES.includes(r.county) && r.mfg_share_pct != null).sort((a, b) => b.mfg_share_pct - a.mfg_share_pct)
      .map((r) => ({ label: r.county, value: r.mfg_share_pct, text: f1(r.mfg_share_pct) + '%', county: r.county, tip: '$' + f1(r.mfg_gdp_m) + 'M in ' + r.year + (r.mfg_chg_pct == null ? '' : ' · ' + sgn(r.mfg_chg_pct) + '% since ' + r.base_year) })),
    { ref: tn && tn.mfg_share_pct != null ? { value: tn.mfg_share_pct, label: 'TN ' + f1(tn.mfg_share_pct) + '%' } : null, onClick: (r) => openCounty(r.county), aria: "Manufacturing share of GDP by county" });
  });
  dash.draw('e_top_ind', (el) => {
    el.replaceChildren();
    const rows = rowsOf('industry_mix');
    if (!rows) return;
    COUNTIES.forEach((c) => {
      const ind = rows.filter((r) => r.county === c && r.order === 99);
      const top3 = ind.filter((r) => r.share_pct != null).sort((a, b) => b.share_pct - a.share_pct).slice(0, 3);
      const wh = ind.filter((r) => r.share_pct == null).map((r) => r.group.replace('industry:', ''));
      const li = h('li', 'sm-item');
      const t = h('div', 'sm-item-top');
      t.appendChild(h('span', 'sm-item-title', c));
      if (wh.length) t.appendChild(h('span', 'sm-item-meta', wh.length + ' withheld'));
      li.appendChild(t);
      li.appendChild(h('p', null, top3.map((r, i) => (i + 1) + '. ' + r.group.replace('industry:', '') + ' ' + f1(r.share_pct) + '%').join(' · ') || '—'));
      if (wh.length) {
        const det = h('details');
        det.appendChild(h('summary', null, 'Read more'));
        det.appendChild(h('p', null, 'Withheld by BEA for confidentiality: ' + wh.join(', ') + '.'));
        li.appendChild(det);
      }
      el.appendChild(li);
    });
  });

  /* Census ACS workforce & community */
  valueDraw('acs_period', str);
  const acsBars = (name, field, fmt, tipOf) => dash.draw(name, (el) => {
    if (pending(el, ['acs_county'])) return;
    const rows = rowsOf('acs_county');
    const tn = rows.find((r) => r.county === 'Tennessee');
    hbars(el, rows.filter((r) => COUNTIES.includes(r.county) && r[field] != null).sort((a, b) => b[field] - a[field])
      .map((r) => ({ label: r.county, value: r[field], text: fmt(r[field]), county: r.county, tip: tipOf ? tipOf(r) : fmt(r[field]) })),
    { ref: tn && tn[field] != null ? { value: tn[field], label: 'TN ' + fmt(tn[field]) } : null, onClick: (r) => openCounty(r.county) });
  });
  acsBars('acs_lfpr', 'lfpr_pct', pct1);
  acsBars('acs_age', 'median_age', f1, (r) => f1(r.age65_pct) + '% are 65 or older');
  acsBars('acs_commute', 'commute_min', (v) => f1(v) + ' min', (r) => f1(r.wfh_pct) + '% work from home');
  acsBars('acs_mfgw', 'mfg_workers_pct', pct1);
  acsBars('acs_bb', 'broadband_pct', pct1);
  acsBars('acs_vets', 'veterans_pct', pct1);
  acsBars('acs_unins', 'uninsured_pct', pct1);
  acsBars('acs_hs', 'hs_plus_pct', pct1);
  acsBars('acs_assoc', 'assoc_pct', pct1);
  acsBars('acs_home', 'home_value', (v) => '$' + Math.round(v / 1000) + 'K', (r) => '$' + int(r.home_value));
  acsBars('acs_rent', 'gross_rent', (v) => '$' + int(v));
  acsBars('acs_vacant', 'vacant_pct', pct1);

  /* tourism */
  valueDraw('tr_year', str); valueDraw('tr_spend', (v) => f1(v / 1e9)); valueDraw('tr_chg', (v) => sgn(v), { goodIf: (v) => v > 0 });
  valueDraw('tr_jobs', f1); valueDraw('tr_jobs_chg', (v) => sgn(v), { goodIf: (v) => v > 0 });
  const m1 = (v) => '$' + f1(v / 1e6) + 'M';
  valueDraw('tu_spend', m1); valueDraw('tu_spend_chg', (v) => sgn(v) + '%', { goodIf: (v) => v > 0 }); valueDraw('tu_tn_chg', (v) => sgn(v) + '%');
  valueDraw('tu_jobs', int); valueDraw('tu_jobs_chg', sgnInt, { goodIf: (v) => v > 0 }); valueDraw('tu_tax', m1); valueDraw('tu_state_tax', m1); valueDraw('tu_local_tax', m1);
  valueDraw('tu_share', (v) => f1(v) + '%'); valueDraw('tu_top', str); valueDraw('tu_top_rank', str); valueDraw('tu_year', str); valueDraw('tu_pyear', str);
  const tuRows = () => (rowsOf('tourism_summary') || []).filter((r) => r.county !== 'Region' && r.county !== 'Tennessee');
  const rankTxt = (r) => '#' + r.rank + ' of 95' + (r.rank_change ? ' (' + (r.rank_change > 0 ? 'up ' : 'down ') + Math.abs(r.rank_change) + ')' : ' (no change)');
  const chgTxt = (v) => (v == null ? 'about the same' : sgn(v) + '%');
  const tuTip = (r) => m1(r.spending) + ' · ' + chgTxt(r.spend_chg_pct) + ' vs ' + r.prior_year + ' · ' + rankTxt(r);
  dash.draw('tu_map', (el) => {
    if (pending(el, ['tourism_summary'])) return;
    tileMap(el, tuRows().map((r) => ({ county: r.county, value: r.spending, text: m1(r.spending), tip: tuTip(r) })),
      { loLabel: 'Less spending', hiLabel: 'More', aria: 'Map of 2025 visitor spending by county' });
  });
  dash.draw('tu_spend_bars', (el) => {
    if (pending(el, ['tourism_summary'])) return;
    hbars(el, tuRows().sort((a, b) => b.spending - a.spending).map((r) => ({ label: r.county, value: r.spending, text: m1(r.spending) + '  #' + r.rank,
      tip: tuTip(r) + (r.spend_chg_2018 != null ? ' · ' + sgn(r.spend_chg_2018) + '% since ' + r.base_year : '') })), { aria: 'Visitor spending by county with state rank' });
  });
  dash.draw('tu_chg_bars', (el) => {
    if (pending(el, ['tourism_summary'])) return;
    const tn = rowsOf('tourism_summary').find((r) => r.county === 'Tennessee');
    hbars(el, tuRows().filter((r) => r.spend_chg_pct != null).sort((a, b) => b.spend_chg_pct - a.spend_chg_pct).map((r) => ({ label: r.county, value: r.spend_chg_pct, text: sgn(r.spend_chg_pct) + '%',
      tip: m1(r.spending_24) + ' in ' + r.prior_year + ' → ' + m1(r.spending) + ' in ' + r.year })), { fmt: (v) => sgn(v) + '%', ref: tn ? { value: tn.spend_chg_pct, label: 'TN ' + sgn(tn.spend_chg_pct) + '%' } : null, aria: 'Change in visitor spending from 2024' });
  });
  dash.draw('tu_jobs_bars', (el) => {
    if (pending(el, ['tourism_summary'])) return;
    hbars(el, tuRows().sort((a, b) => b.jobs - a.jobs).map((r) => ({ label: r.county, value: r.jobs,
      tip: int(r.jobs) + ' jobs (' + sgnInt(r.jobs_chg) + ' vs ' + r.prior_year + ') · ' + m1(r.labor_income) + ' labor income' })), { aria: 'Tourism jobs by county' });
  });
  dash.draw('tu_tax_bars', (el) => {
    if (pending(el, ['tourism_summary'])) return;
    hbars(el, tuRows().sort((a, b) => b.taxes - a.taxes).map((r) => ({ label: r.county, value: r.taxes, text: m1(r.taxes),
      tip: m1(r.state_taxes) + ' state · ' + m1(r.local_taxes) + ' local' + (r.tax_hh != null ? ' · tax savings per household $' + int(r.tax_hh) : '') })), { aria: 'State and local taxes from visitor spending by county' });
  });
  dash.draw('tu_mix', (el) => {
    if (pending(el, ['tourism_summary'])) return;
    const reg = rowsOf('tourism_summary').find((r) => r.county === 'Region');
    if (!reg) return;
    hbars(el, [['Food & beverages', 'food_bev'], ['Transportation', 'transportation'], ['Lodging', 'lodging'], ['Recreation', 'recreation'], ['Retail', 'retail']]
      .map(([l, k]) => ({ label: l, value: reg[k], text: m1(reg[k]) + ' · ' + f1((100 * reg[k]) / reg.spending) + '%' })).sort((a, b) => b.value - a.value), { aria: 'Where visitors spend in the region' });
  });

  /* projects as cards */
  const projectCard = (r) => {
    const d = h('div');
    const top = h('div', 'sm-item-top');
    top.appendChild(h('span', 'sm-item-title', r.project));
    top.appendChild(h('span', 'sm-pill', r.county));
    d.appendChild(top);
    d.appendChild(h('span', 'sm-item-meta', r.location + ' · ' + r.sector));
    d.appendChild(h('span', 'sm-big', r.investment_label));
    d.appendChild(h('span', 'sm-item-meta', 'Jobs: ' + r.jobs_label));
    d.appendChild(h('p', 'sm-note', r.summary));
    const det = h('details');
    det.appendChild(h('summary', null, 'Read more'));
    det.appendChild(h('p', null, r.detail));
    det.appendChild(h('p', null, 'Announced ' + dayFmt(r.announced)));
    if (r.source_url) { const p = h('p'); p.appendChild(link(r.source_url, 'Source ↗')); det.appendChild(p); }
    d.appendChild(det);
    return d;
  };
  dash.draw('g_projects', (el) => { el.replaceChildren(); const rows = rowsOf('projects'); if (rows) rows.slice().sort((a, b) => b.investment_m - a.investment_m).forEach((r) => el.appendChild(projectCard(r))); });
  dash.draw('ag_projects', (el) => {
    el.replaceChildren();
    const rows = rowsOf('projects');
    if (!rows) return;
    rows.filter((r) => r.category === 'Agriculture').forEach((r) => {
      const li = h('li', 'sm-item');
      const top = h('div', 'sm-item-top');
      top.appendChild(h('span', 'sm-item-title', r.project + ' · ' + r.investment_label));
      top.appendChild(h('span', 'sm-pill', r.county));
      li.appendChild(top);
      li.appendChild(h('span', 'sm-item-meta', r.location + ' · Jobs: ' + r.jobs_label));
      li.appendChild(h('p', null, r.summary));
      const det = h('details');
      det.appendChild(h('summary', null, 'Read more'));
      det.appendChild(h('p', null, r.detail));
      if (r.source_url) { const p = h('p'); p.appendChild(link(r.source_url, 'Source ↗')); det.appendChild(p); }
      li.appendChild(det);
      el.appendChild(li);
    });
  });

  /* housing */
  valueDraw('h_year', str); valueDraw('h_units', int); valueDraw('h_units_prev', int); valueDraw('h_mtg', f2); valueDraw('h_mtg_d', str);
  dash.draw('h_permits', (el) => {
    if (pending(el, ['permits'])) return;
    const rows = rowsOf('permits');
    const years = [...new Set(rows.map((r) => r.year))].sort();
    const latest = years[years.length - 1];
    const by = d3.group(rows, (r) => r.county);
    const order = COUNTIES.slice().sort((a, b) => ((by.get(b) || []).find((r) => r.year === latest)?.units || 0) - ((by.get(a) || []).find((r) => r.year === latest)?.units || 0));
    const W = W0(el), sub = 7, gapY = 8, top = 22;
    const H = top + order.length * (years.length * sub + gapY) + 4;
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Housing units permitted by county and year');
    const lw = Math.ceil(d3.max(order, (c) => measure(svg, c, 'sm-lbl'))) + 10;
    const vw = Math.ceil(measure(svg, int(d3.max(rows, (r) => r.units)), 'sm-val')) + 8;
    const x = d3.scaleLinear([0, d3.max(rows, (r) => r.units) || 1], [lw, W - vw]);
    const op = (i) => 0.35 + 0.65 * (i / Math.max(1, years.length - 1));
    let lx = lw;
    years.forEach((y, i) => {
      svg.append('rect').attr('x', lx).attr('y', 4).attr('width', 12).attr('height', 10).attr('rx', 2).style('fill', dash.colors[0]).style('fill-opacity', op(i));
      svg.append('text').attr('class', 'sm-tick').attr('x', lx + 16).attr('y', 13).text(String(y));
      lx += 16 + measure(svg, String(y), 'sm-tick') + 12;
    });
    const tt = tip(el);
    order.forEach((c, k) => {
      const gy = top + k * (years.length * sub + gapY);
      svg.append('text').attr('class', 'sm-lbl').attr('x', lw - 10).attr('y', gy + (years.length * sub) / 2).attr('dy', '0.35em').attr('text-anchor', 'end').text(c);
      years.forEach((y, i) => {
        const r = (by.get(c) || []).find((q) => q.year === y);
        const v = r ? r.units : 0;
        svg.append('rect').attr('x', lw).attr('y', gy + i * sub).attr('width', Math.max(1, x(v) - lw)).attr('height', sub - 1).attr('rx', 2).style('fill', dash.colors[0]).style('fill-opacity', op(i))
          .on('mousemove', (ev) => tt.show(ev, [c + ' · ' + y, int(v) + ' units'])).on('mouseleave', () => tt.hide());
        if (y === latest) svg.append('text').attr('class', 'sm-val').attr('x', x(v) + 4).attr('y', gy + i * sub + sub / 2).attr('dy', '0.35em').text(int(v));
      });
    });
  });
  dash.draw('h_news', (el) => {
    el.replaceChildren();
    const p = rowsOf('programs'), i = rowsOf('intel');
    if (p) p.filter((r) => r.topic === 'Housing').forEach((r) => el.appendChild(programItem(r)));
    if (i) i.filter((r) => r.topic === 'Housing').forEach((r) => el.appendChild(intelItem(r)));
  });

  /* county profile */
  const pv = (name, fmt) => valueDraw(name, fmt, { county: true });
  pv('pf_name', str); pv('pf_seat', str); pv('pf_tier', str); pv('pf_month', str); pv('pf_rate', f1); pv('pf_lf', int);
  pv('pf_pop', int); pv('pf_popchg', (v) => sgn(v)); pv('pf_popbase', str); pv('pf_mhi', int); pv('pf_pov', f1); pv('pf_pcpi', int); pv('pf_gdp', f2);
  pv('pf_est', int); pv('pf_bach', f1); pv('pf_bp', int); pv('pf_mfg', int); pv('pf_mfgshare', f1); pv('pf_farm', f1);
  pv('pf_mfggdp', f1); pv('pf_age', f1); pv('pf_lfpr', f1); pv('pf_commute', f1); pv('pf_bb', f1); pv('pf_home', int);
  pv('pf_corridor', str); pv('pf_park', str); pv('pf_power', str); pv('pf_anchors', str); pv('pf_challenges', str);
  pv('pf_mayor', str); pv('pf_ed', str); pv('pf_city', str); pv('pf_leg', str);
  dash.draw('pf_badge', (el) => {
    el.replaceChildren();
    const rows = rowsOf('counties');
    const r = rows ? rows.find((q) => q.county === selCounty()) : null;
    if (!r) { el.textContent = '—'; return; }
    el.appendChild(h('span', 'sm-pill ' + (r.profile_verified ? 'ok' : 'unv'), r.profile_verified ? 'Profile verified ' + (r.profile_checked || '') : 'Profile text unverified'));
  });
  dash.draw('pf_trend', (el) => {
    if (pending(el, ['urn_trend'])) return;
    const c = selCounty();
    const rows = rowsOf('urn_trend');
    const ser = (name) => rows.filter((r) => r.series === name).map((r) => ({ date: parseDay(r.date), value: r.rate }));
    lineChart(el, [
      { name: c, values: ser(c), color: dash.colors[0] },
      { name: 'TN', values: ser('Tennessee'), color: 'var(--cds-chart-muted)', dashed: true },
    ], { height: 180, fmt: (v) => f1(v) + '%', yfmt: (v) => f1(v) + '%', aria: c + ' unemployment over the last two years' });
  });
  dash.draw('pf_links', (el) => {
    el.replaceChildren();
    const rows = rowsOf('counties');
    const r = rows ? rows.find((q) => q.county === selCounty()) : null;
    if (!r) return;
    el.appendChild(h('span', null, 'Learn more:'));
    if (r.quickfacts_url) el.appendChild(link(r.quickfacts_url, 'Census QuickFacts ↗'));
    if (r.profile_pdf) el.appendChild(link(r.profile_pdf, 'County profile PDF ↗'));
    if (r.notebook_url) el.appendChild(link(r.notebook_url, 'Your Gemini Notebook ↗'));
    if (r.tier_source_url) el.appendChild(link(r.tier_source_url, 'Tier map ↗'));
  });
  dash.draw('cmp_body', (el) => {
    el.replaceChildren();
    const rows = rowsOf('county_all');
    if (!rows) return;
    const c = selCounty();
    sortRows(rows, SORT.compare).filter((r) => !cmpQuery || r.county.toLowerCase().includes(cmpQuery)).forEach((r) => {
      const tr = h('tr');
      tr.dataset.key = r.county;
      tr.style.cursor = 'pointer';
      if (r.county === c) tr.style.fontWeight = '600';
      const n = (v, f) => (v == null ? '—' : f(v));
      [r.county, n(r.tier, str), n(r.rate, f1), n(r.lf, int), n(r.pop, int), n(r.pop_chg_pct, (v) => sgn(v)), n(r.mhi, usd), n(r.poverty, f1),
        n(r.pcpi, usd), n(r.gdp_b, f2), n(r.est, int), n(r.bach_pct, f1), n(r.permits, int), n(r.mfg_jobs, int), n(r.mfg_lq, f2), n(r.farm_sales_m, f1), n(r.lfpr_pct, f1), n(r.median_age, f1)].forEach((v) => tr.appendChild(h('td', null, v)));
      el.appendChild(tr);
    });
  });

  /* projects & grants */
  valueDraw('g_inv', f2); valueDraw('g_proj', int); valueDraw('g_jobs', int); valueDraw('g_actions', int); valueDraw('g_actions_dated', int);
  dash.draw('g_actions_list', (el) => {
    el.replaceChildren();
    const rows = rowsOf('actions');
    if (!rows) return;
    rows.slice().sort((a, b) => (a.deadline || '9999') < (b.deadline || '9999') ? -1 : 1).forEach((r) => {
      const li = h('li', 'sm-item');
      const top = h('div', 'sm-item-top');
      top.appendChild(h('span', 'sm-item-title', r.action));
      if (r.deadline) {
        const d = daysUntil(r.deadline);
        top.appendChild(h('span', 'sm-pill ' + (d < 0 ? 'late' : d <= 7 ? 'late' : d <= 21 ? 'soon' : ''), d < 0 ? 'Past due' : 'Due ' + parseDay(r.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) + ' · ' + d + ' days'));
      } else top.appendChild(h('span', 'sm-pill', r.window || r.urgency));
      li.appendChild(top);
      li.appendChild(h('p', null, r.summary));
      const det = h('details');
      det.appendChild(h('summary', null, 'Steps'));
      const ul = h('ul');
      String(r.steps || '').split('\n').filter(Boolean).forEach((s) => ul.appendChild(h('li', null, s)));
      det.appendChild(ul);
      if (r.source_url) { const p = h('p'); p.appendChild(link(r.source_url, 'Source ↗')); det.appendChild(p); }
      li.appendChild(det);
      el.appendChild(li);
    });
  });
  dash.draw('g_programs', (el) => { el.replaceChildren(); const rows = rowsOf('programs'); if (rows) rows.forEach((r) => el.appendChild(programItem(r))); });
  dash.draw('g_events', (el) => {
    el.replaceChildren();
    const rows = rowsOf('events');
    if (!rows) return;
    rows.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((r) => {
      const li = h('li', 'sm-item');
      const top = h('div', 'sm-item-top');
      top.appendChild(h('span', 'sm-item-title', r.event));
      top.appendChild(h('span', 'sm-pill', r.county));
      li.appendChild(top);
      const meta = h('span', 'sm-item-meta', dayFmt(r.date) + (r.end_date ? ' – ' + dayFmt(r.end_date) : '') + ' · ' + r.location + ' · ');
      if (r.source_url) meta.appendChild(link(r.source_url, 'Source ↗'));
      li.appendChild(meta);
      el.appendChild(li);
    });
  });

  /* resources */
  dash.draw('r_all', (el) => {
    el.replaceChildren();
    const rows = rowsOf('resources');
    if (!rows) return;
    d3.group(rows, (r) => r.category).forEach((items, cat) => {
      const box = h('div');
      box.appendChild(h('span', 'sm-item-title', cat));
      const ul = h('ul', 'sm-list');
      linkList(ul, items);
      box.appendChild(ul);
      el.appendChild(box);
    });
  });

  dash.draw('g_awards', (el) => {
    if (pending(el, ['awards'])) return;
    const rows = rowsOf('awards').slice().sort((a, b) => (a.announced < b.announced ? 1 : a.announced > b.announced ? -1 : String(a.county).localeCompare(String(b.county))));
    const box = h('div', 'sm-tablebox'), t = h('table', 'sm-table'), hr = h('tr');
    ['Announced', 'County', 'Recipient', 'Program', 'Amount', 'Purpose', 'Source'].forEach((x) => hr.appendChild(h('th', null, x)));
    const th = h('thead'); th.appendChild(hr); t.appendChild(th);
    const tb = h('tbody');
    rows.forEach((r) => {
      const tr = h('tr');
      tr.appendChild(h('td', null, dayFmt(r.announced)));
      tr.appendChild(h('td', 'sm-wrap', r.county));
      tr.appendChild(h('td', 'sm-wrap', r.recipient));
      tr.appendChild(h('td', null, r.program));
      tr.appendChild(h('td', null, r.amount_label || (r.amount != null ? usd(r.amount) : '—')));
      tr.appendChild(h('td', 'sm-wrap', r.purpose));
      const s = h('td'); if (r.source_url) s.appendChild(link(r.source_url, 'Source ↗')); else s.textContent = '—'; tr.appendChild(s);
      tb.appendChild(tr);
    });
    t.appendChild(tb); box.appendChild(t); el.replaceChildren(box);
  });

  /* ---------- sites map (TVA Sites and MTIDA property maps) ----------
     Claude dashboards do not allow another website inside the page, so there the buttons open the maps in a new tab.
     The public copy (its runtime defines window.__dashStart) also shows the chosen map in the page, loaded on first view. */
  const SITE_MAPS = {
    tva: { label: 'TVA Sites', title: 'TVA Sites map: industrial sites and buildings, Southern Middle Tennessee region', url: 'https://tvasites.giswebtechguru.com/?sorting=featured&showcommunityonmap=true&layer=Region&activebasemap2d=World%20Navigation%20Map%20(Places)&mapextent=-9388814.803837564,4490805.938632733,-9973405.196162436,4065816.0613672663&mapzoom=7&FIPSCode=OID436' },
    mtida: { label: 'MTIDA properties', title: 'MTIDA properties map: Middle Tennessee industrial sites and buildings', url: 'https://mtida.giswebtechguru.com/?sorting=featured&showpropertyonmap=true&activebasemap2d=World%20Street%20Map%20(Places)&mapextent=-9321791.803837564,4490815.438632733,-9906382.196162436,4065825.5613672663&mapzoom=7' },
  };
  const MAP_IN_PAGE = typeof window.__dashStart === 'function';
  let mapPick = 'tva';
  dash.draw('site_map', (el) => {
    if (!MAP_IN_PAGE) { el.replaceChildren(); return; }
    let f = el.querySelector('iframe');
    if (!f) { f = document.createElement('iframe'); f.className = 'sm-mapframe'; f.setAttribute('allow', 'fullscreen; geolocation'); f.setAttribute('allowfullscreen', ''); el.replaceChildren(f); }
    if (f.getAttribute('src') !== SITE_MAPS[mapPick].url) { f.title = SITE_MAPS[mapPick].title; f.src = SITE_MAPS[mapPick].url; }
  });
  if (MAP_IN_PAGE) {
    // the public copy shows the map in the page: reveal the picker and hide the "opens in a new tab" note
    document.querySelectorAll('#sm-mappick').forEach((e) => { e.hidden = false; });
    document.querySelectorAll('#sm-mapnote').forEach((e) => { e.hidden = true; });
    document.addEventListener('click', (ev) => {
      const pick = ev.target.closest('#sm-mappick button[data-map]');
      if (!pick || !SITE_MAPS[pick.dataset.map]) return;
      mapPick = pick.dataset.map;
      document.querySelectorAll('#sm-mappick button[data-map]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.map === mapPick)));
      dash.draw('site_map');
    });
  }

  /* ---------- site search ---------- */
  const SEARCH_SETS = ['counties', 'projects', 'programs', 'events', 'intel', 'warn', 'stories', 'radar_feed', 'resources', 'edu_colleges', 'notebooks', 'actions', 'sp_employers', 'awards'];
  function searchIndex() {
    const items = [];
    const add = (type, title, fields, go, url) => { const text = fields.filter((x) => x != null && x !== '').map(String).join(' · '); items.push({ type, title: String(title || ''), text, go, url, hay: (title + ' ' + text).toLowerCase() }); };
    document.querySelectorAll('.sm-page').forEach((sec) => {
      const tab = document.querySelector('.sm-tab[data-tab="' + sec.id + '"]');
      const tabName = tab ? tab.textContent.trim() : sec.id;
      add('Tab', tabName, [], { tab: sec.id });
      sec.querySelectorAll('.sm-card').forEach((card) => {
        const hd = card.querySelector('h3');
        if (hd) add('Section', hd.textContent.trim(), [tabName, [...card.querySelectorAll(':scope > .sm-note')].map((n) => n.textContent.trim()).join(' ')], { tab: sec.id, el: card });
      });
    });
    (rowsOf('counties') || []).forEach((r) => {
      add('County profile', r.county + ' County', ['Seat: ' + r.seat, r.tier_label, r.corridor, r.top_park, r.power, r.anchors, r.challenges, r.workforce_signal], { county: r.county });
      [['County mayor', r.county_mayor], ['Economic development', r.ed_leader], ['City leaders', r.city_leaders], ['State legislators', r.state_legislators]]
        .forEach(([lbl, v]) => { if (v) add('Contact', r.county + ': ' + lbl, [v], { county: r.county }); });
    });
    (rowsOf('projects') || []).forEach((r) => add('Project', r.project, [r.county, r.sector, r.summary, r.detail, r.announced], { tab: 'projects' }, r.source_url));
    (rowsOf('awards') || []).forEach((r) => add('State award', r.recipient + ': ' + r.program, [r.county + ' County', r.amount_label, r.purpose, r.announced], { tab: 'projects' }, r.source_url));
    (rowsOf('programs') || []).forEach((r) => add('Grant or program', r.program, [r.agency, r.topic, r.amount_label, r.deadline ? 'Deadline ' + r.deadline : null, r.summary], { tab: 'projects' }, r.source_url));
    (rowsOf('actions') || []).forEach((r) => add('Action item', r.action, [r.deadline ? 'Deadline ' + r.deadline : null, r.summary], { tab: 'projects' }, r.source_url));
    (rowsOf('events') || []).forEach((r) => add('Event', r.event, [r.county, r.date, r.location], { tab: 'projects' }, r.source_url));
    (rowsOf('intel') || []).forEach((r) => add('Intel', r.headline, [r.topic, r.date, r.body], { tab: 'overview' }, r.source_url));
    (rowsOf('warn') || []).forEach((r) => add('WARN notice', r.company, [r.city, r.county, r.workers + ' workers', r.action, r.notice_date, r.note], { tab: 'workforce' }, r.source_url));
    (rowsOf('stories') || []).forEach((r) => add('News', r.headline, [r.publisher, r.date, r.summary, r.why_it_matters], { tab: 'news' }, r.source_url));
    (rowsOf('radar_feed') || []).forEach((r) => add('AI radar', r.title, [r.lab, r.date, r.impact], { tab: 'news' }, r.url));
    (rowsOf('resources') || []).forEach((r) => add('Resource', r.name, [r.category, r.where, r.description], { tab: 'resources' }, r.url));
    (rowsOf('notebooks') || []).forEach((r) => add('Notebook', r.name, [r.scope], { tab: 'strategy' }, r.url));
    (rowsOf('sp_employers') || []).filter((r) => r.shown).forEach((r) => add('Employer', r.company, [r.county, r.industry, r.employees != null ? r.employees + ' employees' : null, r.status], { tab: 'strategy' }, r.source_url));
    const seen = new Set();
    (rowsOf('edu_colleges') || []).forEach((r) => {
      if (seen.has(r.institution)) return; seen.add(r.institution);
      add('College or TCAT', r.institution, [r.type, r.city, r.county ? r.county + ' County' : null], { tab: 'education' }, r.source_url);
    });
    return items;
  }
  function runSearch(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const res = searchIndex().filter((it) => words.every((w) => it.hay.includes(w)));
    const score = (it) => (words.every((w) => it.title.toLowerCase().includes(w)) ? 0 : 1) + (it.type === 'Tab' ? -1 : 0);
    return res.sort((a, b) => score(a) - score(b)).slice(0, 40);
  }
  const snippet = (text, words) => {
    const low = text.toLowerCase();
    const i = Math.max(0, Math.min(...words.map((w) => { const k = low.indexOf(w); return k < 0 ? Infinity : k; })));
    if (!isFinite(i)) return text.slice(0, 160);
    const s = Math.max(0, i - 60);
    return (s > 0 ? '…' : '') + text.slice(s, s + 180) + (s + 180 < text.length ? '…' : '');
  };
  const markText = (el, text, words) => {
    const low = text.toLowerCase();
    let pos = 0;
    while (pos < text.length) {
      let best = -1, len = 0;
      words.forEach((w) => { const k = low.indexOf(w, pos); if (k >= 0 && (best < 0 || k < best)) { best = k; len = w.length; } });
      if (best < 0) { el.appendChild(document.createTextNode(text.slice(pos))); break; }
      if (best > pos) el.appendChild(document.createTextNode(text.slice(pos, best)));
      el.appendChild(h('mark', null, text.slice(best, best + len)));
      pos = best + len;
    }
  };
  function goTo(it) {
    if (it.go.county) { openCounty(it.go.county); return; }
    if (it.go.tab) showTab(it.go.tab);
    const target = it.go.el || document.getElementById(it.go.tab);
    if (target) setTimeout(() => target.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
  }
  // The results box is a drawing: listeners only store the query, toggle a class and ask for a redraw.
  let searchQ = '';
  dash.draw('sm_search', (el) => {
    el.replaceChildren();
    const q = searchQ.trim();
    if (!q) return;
    const loading = SEARCH_SETS.filter((id) => dash.data(id).status === 'loading');
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const res = runSearch(q);
    el.appendChild(h('div', 'sm-results-head', res.length ? res.length + (res.length === 40 ? '+' : '') + ' match' + (res.length === 1 ? '' : 'es') : 'No matches' + (loading.length ? ' yet (still loading some data)' : '')));
    res.forEach((it) => {
      const row = h('div', 'sm-result');
      const b = h('button', 'sm-result-main'); b.type = 'button';
      const top = h('span', 'sm-result-top'); top.appendChild(h('span', 'sm-pill', it.type));
      const tt = h('span', 'sm-result-title'); markText(tt, it.title, words); top.appendChild(tt);
      b.appendChild(top);
      if (it.text) { const sn = h('span', 'sm-result-snip'); markText(sn, snippet(it.text, words), words); b.appendChild(sn); }
      b.addEventListener('click', () => { document.querySelectorAll('.sm-results').forEach((r) => r.classList.add('is-off')); goTo(it); });
      row.appendChild(b);
      if (it.url) row.appendChild(link(it.url, 'Source ↗'));
      el.appendChild(row);
    });
  });
  const setSearch = (q) => {
    searchQ = q;
    document.querySelectorAll('.sm-results').forEach((r) => r.classList.toggle('is-off', !q.trim()));
    dash.draw('sm_search');
  };
  let searchTimer;
  document.addEventListener('input', (ev) => {
    if (!ev.target.matches || !ev.target.matches('#sm-q')) return;
    clearTimeout(searchTimer); const v = ev.target.value;
    searchTimer = setTimeout(() => setSearch(v), 120);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !ev.target.matches || !ev.target.matches('#sm-q')) return;
    ev.target.value = ''; setSearch('');
  });
  document.addEventListener('focusin', (ev) => { if (ev.target.matches && ev.target.matches('#sm-q') && ev.target.value.trim()) setSearch(ev.target.value); });
  document.addEventListener('click', (ev) => { if (!ev.target.closest('.sm-searchbar')) document.querySelectorAll('.sm-results').forEach((r) => r.classList.add('is-off')); });

  /* ---------- shared with export.js ---------- */
  window.SM = {
    rowsOf, selCounty, showTab, openCounty, spSwotData, spPlanSteps, spMeasureRows, spF, dayFmt, f1, f2, int, sgn, sgnInt, usd, todayStr,
    planStart: SP_PLAN_START,
    ready(ids, ms = 15000) {
      return new Promise((resolve) => {
        const t0 = Date.now();
        const tick = () => {
          const st = ids.map((id) => dash.data(id).status);
          const settled = st.every((s) => s !== 'loading') && (Date.now() - t0 > 800 || st.every((s) => s !== 'idle' && s != null));
          if (settled || Date.now() - t0 > ms) resolve(ids.filter((id) => dash.data(id).status !== 'ok'));
          else setTimeout(tick, 250);
        };
        tick();
      });
    },
  };
})();
