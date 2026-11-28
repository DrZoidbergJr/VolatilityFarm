(function () {
  var DATE_COL = { key: 'Date', label: 'Date', kind: 'date' };
  var TICKER_COL = { key: 'Ticker', label: 'Ticker', kind: 'text' };

  var GROUPS = [
    { label: '1h entry', cols: [
      { key: '1h->1d F', label: '1d F', kind: 'pct' },
      { key: '1h->1d L', label: '1d L', kind: 'pct' },
      { key: '1h->14d F', label: '14d F', kind: 'pct' },
      { key: '1h->14d L', label: '14d L', kind: 'pct' },
      { key: '1h->28d F', label: '28d F', kind: 'pct' },
      { key: '1h->28d L', label: '28d L', kind: 'pct' }
    ] },
    { label: '3h entry', cols: [
      { key: '3h->1d F', label: '1d F', kind: 'pct' },
      { key: '3h->1d L', label: '1d L', kind: 'pct' },
      { key: '3h->14d F', label: '14d F', kind: 'pct' },
      { key: '3h->14d L', label: '14d L', kind: 'pct' },
      { key: '3h->28d F', label: '28d F', kind: 'pct' },
      { key: '3h->28d L', label: '28d L', kind: 'pct' }
    ] },
    { label: '6h entry', cols: [
      { key: '6h->1d F', label: '1d F', kind: 'pct' },
      { key: '6h->1d L', label: '1d L', kind: 'pct' },
      { key: '6h->14d F', label: '14d F', kind: 'pct' },
      { key: '6h->14d L', label: '14d L', kind: 'pct' },
      { key: '6h->28d F', label: '28d F', kind: 'pct' },
      { key: '6h->28d L', label: '28d L', kind: 'pct' }
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
    if (value === '' || value === undefined || value === null) return '—';
    if (kind === 'pct') {
      var n = parseFloat(value);
      if (isNaN(n)) return value;
      return n.toFixed(2) + '%';
    }
    if (kind === 'date') {
      var parts = value.split('-');
      if (parts.length === 3) return parts[0].slice(2) + '/' + parts[1] + '/' + parts[2];
      return value;
    }
    return value;
  }

  function renderDriftTable(rows) {
    var groupRow = document.getElementById('drift-thead-group-row');
    var subRow = document.getElementById('drift-thead-row');
    var tbody = document.getElementById('drift-tbody');
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
      groupHtml += '<th colspan="' + grp.cols.length + '" style="' + groupThStyle +
        ';border-left:1px solid #EAE2F6;white-space:normal;max-width:76px">' + grp.label + '</th>';
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
      var isToday = rows[r]['Date'] === today;
      var maxDrift = 0;
      for (var dc = 2; dc < COLUMNS.length; dc++) {
        if (COLUMNS[dc].key.indexOf('->28d') !== -1) continue;
        var dn = parseFloat(rows[r][COLUMNS[dc].key]);
        if (!isNaN(dn) && Math.abs(dn) > Math.abs(maxDrift)) maxDrift = dn;
      }
      var driftBg = maxDrift >= 5 ? '#059669' : (maxDrift <= -5 ? '#DC2626' : '');
      var rowStyle = driftBg ? ' style="background:' + driftBg + '"' : (isToday ? ' style="background:#DCCEF4"' : '');
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

  function showDriftStatus(msg) {
    var status = document.getElementById('drift-status');
    var table = document.getElementById('drift-table');
    if (status) { status.textContent = msg; status.style.display = 'block'; }
    if (table) table.style.display = 'none';
  }

  function showDriftTable() {
    var status = document.getElementById('drift-status');
    var table = document.getElementById('drift-table');
    if (status) status.style.display = 'none';
    if (table) table.style.display = 'table';
  }

  function loadDrift() {
    if (!document.getElementById('drift-table')) return;
    showDriftStatus(vfUI.message('loading', 'drift data'));
    fetch('reports/drag_estimates.csv')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (text) {
        var rows = parseCSV(text);
        if (rows.length === 0) {
          showDriftStatus(vfUI.message('empty', 'drift data'));
          return;
        }
        rows = rows.map(function (row, i) { return { row: row, i: i }; })
          .sort(function (a, b) {
            var da = a.row['Date'] || '', db = b.row['Date'] || '';
            return da < db ? 1 : (da > db ? -1 : a.i - b.i);
          })
          .map(function (x) { return x.row; });
        renderDriftTable(rows);
        showDriftTable();
      })
      .catch(function (err) {
        showDriftStatus(vfUI.message('error', 'drift data'));
        console.warn('[drift] failed to load CSV:', err);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadDrift);
  } else {
    loadDrift();
  }
})();
