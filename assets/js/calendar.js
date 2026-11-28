(function () {
  var DATE_COL = { key: 'date', label: 'Date', kind: 'date' };
  var TICKER_COL = { key: 'ticker', label: 'Ticker', kind: 'text' };

  
  var GROUPS = [
    { label: 'Street view', cols: [
      { key: 'street_eps_pct', label: 'EPS', kind: 'pct' },
      { key: 'street_rev_pct', label: 'Rev', kind: 'pct' }
    ] },
    { label: 'Volatility Farm view', cols: [
      { key: 'eps_growth', label: 'EPS', kind: 'pct' },
      { key: 'rev_growth', label: 'Rev', kind: 'pct' }
    ] },
    { label: 'Leads', cols: [
      { key: 'leads_eps_pct', label: 'EPS', kind: 'pct' },
      { key: 'leads_rev_pct', label: 'Rev', kind: 'pct' }
    ] },
    { label: 'Upwards', cols: [
      { key: 'inputs_eps_pct', label: 'EPS', kind: 'pct' },
      { key: 'inputs_rev_pct', label: 'Rev', kind: 'pct' }
    ] },
    { label: 'Downwards', cols: [
      { key: 'outputs_eps_pct', label: 'EPS', kind: 'pct' },
      { key: 'outputs_rev_pct', label: 'Rev', kind: 'pct' }
    ] },
    { label: 'Returns entering before release', cols: [
      { key: 'impact_pre_lead', label: 'Lead', kind: 'pct' },
      { key: 'impact_pre_input', label: 'Upwards', kind: 'pct' },
      { key: 'impact_pre_out', label: 'Downwards', kind: 'pct' }
    ] },
    { label: 'Returns entering 1h after', cols: [
      { key: 'impact_post_lead', label: 'Lead', kind: 'pct' },
      { key: 'impact_post_input', label: 'Upwards', kind: 'pct' },
      { key: 'impact_post_out', label: 'Downwards', kind: 'pct' }
    ] }
  ];

  var COLUMNS = [DATE_COL, TICKER_COL].concat(GROUPS.reduce(function (acc, g) {
    return acc.concat(g.cols);
  }, []));

  var GROUP_START_INDEXES = (function () {
    var idx = [];
    var pos = 2;
    for (var g = 0; g < GROUPS.length; g++) {
      idx.push(pos);
      pos += GROUPS[g].cols.length;
    }
    return idx;
  })();

  function parseCSV(text) {
    var lines = text.replace(/\r\n/g, '\n').split('\n').filter(function (l) { return l.length > 0; });
    if (lines.length < 2) return [];
    var header = lines[0].split(',');
    var rows = [];
    for (var i = 1; i < lines.length; i++) {
      var cells = lines[i].split(',');
      var row = {};
      for (var c = 0; c < header.length; c++) {
        row[header[c].trim()] = cells[c] !== undefined ? cells[c].trim() : '';
      }
      rows.push(row);
    }
    return rows;
  }

  function formatCell(value, kind) {
    if (value === '' || value === undefined || value === null) return '\u2014';
    if (kind === 'pct') {
      var n = parseFloat(value);
      if (isNaN(n)) return value;
      if (n === 0) return '-';
      if (Math.abs(n) > 10) return '-';
      return (n * 100).toFixed(2) + '%';
    }
    if (kind === 'date') {
      var parts = value.split('-');
      if (parts.length === 3) return parts[0].slice(2) + '/' + parts[1] + '/' + parts[2];
      return value;
    }
    return value;
  }

  function renderTable(rows) {
    var groupRow = document.getElementById('calendar-thead-group-row');
    var subRow = document.getElementById('calendar-thead-row');
    var tbody = document.getElementById('calendar-tbody');
    if (!groupRow || !subRow || !tbody) return;

    var groupThStyle = 'text-align:center;padding:6px 4px 4px;border-bottom:1px solid #EAE2F6;' +
      'font-family:\'IBM Plex Mono\',monospace;font-size:9px;letter-spacing:0.04em;text-transform:uppercase;' +
      'color:#4C1D95;white-space:nowrap';
    var subThStyle = 'text-align:center;padding:4px 4px 8px;border-bottom:1px solid #EAE2F6;' +
      'font-family:\'IBM Plex Mono\',monospace;font-size:9px;letter-spacing:0.03em;text-transform:uppercase;' +
      'color:#6D28D9;white-space:nowrap';

    var groupHtml = '<th rowspan="2" style="' + groupThStyle + '">' + DATE_COL.label + '</th>' + '<th rowspan="2" style="' + groupThStyle + '">' + TICKER_COL.label + '</th>';
    var subHtml = '';
    for (var g = 0; g < GROUPS.length; g++) {
      var grp = GROUPS[g];
      var titleAttr = grp.tooltip ? ' title="' + grp.tooltip + '"' : '';
      groupHtml += '<th colspan="' + grp.cols.length + '" style="' + groupThStyle +
        ';border-left:1px solid #EAE2F6;white-space:normal;max-width:76px"' + titleAttr + '>' + grp.label + '</th>';
      for (var c = 0; c < grp.cols.length; c++) {
        var borderLeft = c === 0 ? ';border-left:1px solid #EAE2F6' : '';
        subHtml += '<th style="' + subThStyle + borderLeft + '">' + grp.cols[c].label + '</th>';
      }
    }
    groupRow.innerHTML = groupHtml;
    subRow.innerHTML = subHtml;

    function todayStr() {
      var d = new Date();
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return d.getFullYear() + '-' + m + '-' + day;
    }
    var today = todayStr();
    var bodyHtml = '';
    for (var r = 0; r < rows.length; r++) {
      var isToday = rows[r].date === today;
      var rowStyle = isToday ? ' style="background:#DCCEF4"' : '';
      bodyHtml += '<tr' + rowStyle + '>';
      for (var c = 0; c < COLUMNS.length; c++) {
        var col = COLUMNS[c];
        var raw = rows[r][col.key];
        var isGroupStart = GROUP_START_INDEXES.indexOf(c) !== -1;
        var tdBorder = isGroupStart ? ';border-left:1px solid #EAE2F6' : '';
        var cellText = formatCell(raw, col.kind);
        bodyHtml += '<td style="text-align:center;padding:6px 4px;border-bottom:1px solid #EAE2F6;' +
          'font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#2B1240;white-space:nowrap' + tdBorder + '">' +
          cellText + '</td>';
      }
      bodyHtml += '</tr>';
    }
    tbody.innerHTML = bodyHtml;
  }

  function showStatus(msg) {
    var status = document.getElementById('calendar-status');
    var table = document.getElementById('calendar-table');
    if (status) { status.textContent = msg; status.style.display = 'block'; }
    if (table) table.style.display = 'none';
  }

  function showTable() {
    var status = document.getElementById('calendar-status');
    var table = document.getElementById('calendar-table');
    if (status) status.style.display = 'none';
    if (table) table.style.display = 'table';
  }

  function loadCalendar() {
    if (!document.getElementById('calendar-table')) return;
    showStatus(vfUI.message('loading', 'calendar data'));
    fetch('reports/res_relevant_slice.csv')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (text) {
        var rows = parseCSV(text);
        if (rows.length === 0) {
          showStatus(vfUI.message('empty', 'calendar data'));
          return;
        }
        renderTable(rows);
        showTable();
      })
      .catch(function (err) {
        showStatus(vfUI.message('error', 'calendar data'));
        console.warn('[calendar] failed to load CSV:', err);
      });
  }

  function renderQuarterProgress() {
    var fill = document.getElementById('quarter-progress-fill');
    var label = document.getElementById('quarter-progress-label');
    if (!fill || !label) return;
    var now = new Date();
    var year = now.getFullYear();
    var quarter = Math.floor(now.getMonth() / 3) + 1;
    var qStartMonth = (quarter - 1) * 3;
    var start = new Date(year, qStartMonth, 1);
    var end = new Date(year, qStartMonth + 3, 1);
    var pct = (now.getTime() - start.getTime()) / (end.getTime() - start.getTime());
    pct = Math.max(0, Math.min(1, pct)) * 100;
    fill.style.width = pct.toFixed(1) + '%';
    label.textContent = year + ' Q' + quarter + ' — ' + pct.toFixed(0) + '% elapsed';
  }

  renderQuarterProgress();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadCalendar);
  } else {
    loadCalendar();
  }
})();
