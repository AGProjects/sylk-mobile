// app/qosReport.js — QoS call-report renderers, extracted from app.js.
//
// Two pure builders that turn a saved qos record into a report:
//   - formatQosReport(record, userAgent)     -> monospace text (support email,
//                                                console dump, text fallback)
//   - formatQosReportHtml(record, userAgent) -> self-contained HTML document
//                                                (headers + <table>s) shown in
//                                                the QoS modal via WebView and
//                                                used for sharing
//
// Kept out of the giant app.js on purpose: app.js is a huge root module with
// top-level side effects, so editing it forces Metro into a FULL reload (which
// is what kept wiping in-memory QoS state mid-debug). This module is a small
// leaf with no side effects, so Fast Refresh can hot-swap it without a reload.
//
// `userAgent` is passed in (app.js owns the USER_AGENT constant) so these stay
// pure and importable from anywhere.

const _stripCall = (t) => (typeof t === 'string' ? t.replace(/^CALL\s+/i, '') : t);

/** Render a saved qos record into a readable multi-line text report. */
export function formatQosReport(record, userAgent) {
    const srv = (record && record.server) || {};
    const cli = (record && record.client) || {};
    const r = (record && record.reconciliation) || {};
    const up = r.uplink || {};
    const down = r.downlink || {};
    const legs = srv.legs || {};
    const w = legs.webrtc || {};
    const s = legs.sip || {};
    const L = [];
    const val = (v) => (v == null || v === '') ? '?' : v;
    // A call carrying video is labelled "video" (not "audio+video").
    const mediaLabel = (srv.media_types && srv.media_types.indexOf('video') > -1)
        ? 'video'
        : ((srv.media_types && srv.media_types.length) ? srv.media_types.join('+') : 'media');
    const pkts = (v) => (v != null ? v : '?');

    // Real box-drawing table. If hasHeader, rows[0] is a header separated from
    // the body by a rule.
    const table = (rows, hasHeader) => {
        const ncol = Math.max(...rows.map((row) => row.length));
        const cw = [];
        for (let c = 0; c < ncol; c++) {
            cw[c] = Math.max(...rows.map((row) => String(row[c] == null ? '' : row[c]).length));
        }
        const rule = (l, m, rgt) => l + cw.map((width) => '─'.repeat(width + 2)).join(m) + rgt;
        const rowLine = (row) => '│' + cw.map((width, c) =>
            ' ' + String(row[c] == null ? '' : row[c]).padEnd(width) + ' ').join('│') + '│';
        const out = [rule('┌', '┬', '┐')];
        rows.forEach((row, i) => {
            out.push(rowLine(row));
            if (hasHeader && i === 0) out.push(rule('├', '┼', '┤'));
        });
        out.push(rule('└', '┴', '┘'));
        return out;
    };
    const divider = (title) => '━━━━━━━━ ' + title + ' ' + '━'.repeat(Math.max(0, 28 - title.length));

    // ---- header -----------------------------------------------------
    L.push('═══ Quality of Service — call report ═══');
    L.push('Call-ID   ' + ((record && record.call_id) || '?'));
    if (srv.sylk_session_id) L.push('Session   ' + srv.sylk_session_id);
    const _date = (record && record.date) || srv.ended_at || null;
    if (_date) {
        let _d = _date;
        const _n = Number(_date);
        if (Number.isFinite(_n) && _n > 0) {
            _d = new Date(_n < 1e12 ? _n * 1000 : _n).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
        }
        L.push('Date      ' + _d);
    }
    if (record && (record.from_uri || record.to_uri)) {
        L.push('From      ' + val(record.from_uri));
        L.push('To        ' + val(record.to_uri));
    }
    L.push('Media     ' + ((srv.media_types || []).join(', ') || '?')
           + '    Duration  ' + (srv.duration_s != null ? srv.duration_s + 's' : '?'));
    const ua = (srv.user_agents) || {};
    L.push('Device    ' + (ua.local || userAgent || '?') + '  (this device)');
    L.push('Remote    ' + val(ua.remote));
    L.push('');

    // ---- SERVER -----------------------------------------------------
    L.push(divider('SylkServer statistics'));
    L.push(_stripCall(srv.evaluation_text || srv.evaluation || 'n/a'));
    // Real Janus IP: prefer the daemon's webrtc-leg fields; otherwise derive
    // the IP from the SIP leg (same Janus host) + the WebRTC media port, so we
    // show a real address even against an older daemon that didn't send it.
    const _sipJanusIp = (typeof s.janus === 'string' && s.janus.indexOf(':') > -1) ? s.janus.split(':')[0] : null;
    const _janusIp = w.janus_ip || _sipJanusIp;
    const janus = w.janus || (_janusIp ? _janusIp + ':' + val(w.janus_port) : 'Janus:' + val(w.janus_port));
    if (w && Object.keys(w).length) {
        L.push('');
        L.push('WebRTC media · this device ↔ Janus');
        L.push(...table([
            [mediaLabel, 'out', pkts(w.packets_client_to_server), val(w.client) + ' → ' + janus],
            [mediaLabel, 'in', pkts(w.packets_server_to_client), val(w.client) + ' ← ' + janus],
        ]));
    }
    if (s && Object.keys(s).length) {
        L.push('');
        L.push('SIP/RTP media · Janus ↔ MediaProxy (caller-facing leg)');
        if (Array.isArray(s.streams) && s.streams.length) {
            L.push('  streams: ' + s.streams.map((x) =>
                (x.media || '?') + ' ' + (x.remote_ip || '?') + ':' + (x.remote_port || '?')).join(', '));
        }
        L.push(...table([
            [mediaLabel, 'out', pkts(s.packets_janus_to_mediaproxy), val(s.janus) + ' → ' + val(s.mediaproxy)],
            [mediaLabel, 'in', pkts(s.packets_mediaproxy_to_janus), val(s.janus) + ' ← ' + val(s.mediaproxy)],
        ]));
    }
    L.push('');

    // ---- CLIENT -----------------------------------------------------
    L.push(divider('Blink statistics'));
    L.push(cli.domain ? cli.domain + (cli.reason ? ' — ' + cli.reason : '') : 'no data');
    if (cli.packetsSent != null) {
        const cpath = val(w.client);
        L.push('');
        L.push(...table([
            [mediaLabel, 'out', cli.packetsSent, cpath + ' → ' + janus],
            [mediaLabel, 'in', cli.packetsReceived, cpath + ' ← ' + janus],
        ]));
        L.push('  ice ' + (cli.iceState || '?') + ' · dtls ' + (cli.dtlsState || '?')
               + ' · rtt ' + (cli.rttMs != null ? cli.rttMs + 'ms' : '?'));
    }
    const fmt = (v, unit) => (v != null && v !== '?') ? (v + (unit || '')) : '?';
    if (cli.lossIn != null || cli.concealPct != null || cli.jbDelayMs != null) {
        L.push('  loss in ' + fmt(cli.lossIn, '%') + ' · out ' + fmt(cli.lossOut, '%')
               + ' · conceal ' + fmt(cli.concealPct, '%'));
        L.push('  jitter ' + fmt(cli.jbDelayMs, 'ms') + ' · flushes ' + fmt(cli.jbFlushes)
               + ' · pps ' + fmt(cli.ppsRecv));
    }
    L.push('');

    // ---- RECONCILIATION --------------------------------------------
    L.push(divider('RECONCILIATION'));
    const haveClient = !!(record && record.client && (record.client.domain
        || record.client.packetsSent != null || record.client.packetsReceived != null));
    const haveServer = !!(srv && (srv.evaluation || (srv.legs && Object.keys(srv.legs).length)));
    if (!haveClient && !haveServer) {
        L.push('not possible — neither client nor server data available');
    } else if (!haveClient) {
        L.push('not possible without client data');
    } else if (!haveServer) {
        L.push('not possible without server data');
    } else {
        const upLost = up.lost_client_to_server;
        L.push(...table([
            ['dir', 'Blink', 'SylkServer', 'lost'],
            ['out', val(up.client_sent), val(up.server_received), val(upLost)],
            ['in', val(down.client_received), val(down.server_sent), val(down.lost_server_to_client)],
        ], true));
        if (typeof upLost === 'number' && upLost < 0) {
            L.push('  (negative uplink loss = RTCP/STUN + timing, not real loss)');
        }
        L.push('');
        L.push('  client     ' + (r.client_verdict || '?'));
        L.push('  server     ' + _stripCall(r.server_verdict || '?'));
        L.push('  agreement  ' + (r.agree == null ? 'n/a' : (r.agree ? 'AGREE' : 'DISAGREE')));
    }
    return L.join('\n');
}

/** Render the saved qos record as a self-contained HTML document. */
export function formatQosReportHtml(record, userAgent) {
    const srv = (record && record.server) || {};
    const cli = (record && record.client) || {};
    const r = (record && record.reconciliation) || {};
    const up = r.uplink || {};
    const down = r.downlink || {};
    const legs = srv.legs || {};
    const w = legs.webrtc || {};
    const s = legs.sip || {};
    const esc = (v) => (v == null ? '' : String(v)).replace(/[&<>"]/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const val = (v) => (v == null || v === '') ? '?' : esc(v);
    const num = (v) => (v != null ? esc(v) : '?');
    const mediaLabel = (srv.media_types && srv.media_types.indexOf('video') > -1)
        ? 'video'
        : ((srv.media_types && srv.media_types.length) ? srv.media_types.join('+') : 'media');
    const _sipJanusIp = (typeof s.janus === 'string' && s.janus.indexOf(':') > -1) ? s.janus.split(':')[0] : null;
    const _janusIp = w.janus_ip || _sipJanusIp;
    const janus = w.janus ? esc(w.janus) : (_janusIp ? esc(_janusIp) + ':' + val(w.janus_port) : 'Janus:' + val(w.janus_port));

    const ev = (srv.evaluation || '').toLowerCase();
    const vClass = ev === 'ok' ? 'ok' : (ev === 'broken' || ev.indexOf('one-way') > -1 || ev === 'no-media') ? 'broken' : (ev === 'bad' ? 'bad' : '');

    // numCols are right-aligned. If hasHeader, rows[0] becomes a <thead> row.
    const tbl = (rows, numCols, hasHeader) => {
        const isNum = (i) => numCols && numCols.indexOf(i) > -1;
        let head = '';
        let dataRows = rows;
        if (hasHeader) {
            head = '<thead><tr>' + rows[0].map((cell, i) =>
                '<th' + (isNum(i) ? ' class="num"' : '') + '>' + esc(cell) + '</th>').join('') + '</tr></thead>';
            dataRows = rows.slice(1);
        }
        const body = dataRows.map((row) => '<tr>' + row.map((cell, i) =>
            '<td' + (isNum(i) ? ' class="num"' : '') + '>' + (cell == null ? '' : esc(cell)) + '</td>').join('') + '</tr>').join('');
        return '<table>' + head + '<tbody>' + body + '</tbody></table>';
    };

    const H = [];
    H.push('<!doctype html><html><head><meta charset="utf-8">');
    H.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
    H.push('<style>'
        + 'body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:14px;color:#1b1b1b;font-size:14px;-webkit-text-size-adjust:100%}'
        + 'h1{font-size:19px;margin:0 0 2px}'
        + 'h2{font-size:15px;margin:20px 0 6px;color:#6A1B9A;border-bottom:2px solid #6A1B9A;padding-bottom:3px}'
        + 'h3{font-size:13px;margin:14px 0 4px;color:#444;font-weight:600}'
        + '.meta{color:#555;font-size:13px;line-height:1.6;margin-bottom:4px}'
        + '.meta b{color:#1b1b1b;font-weight:600}'
        + '.verdict{font-weight:700;margin:4px 0;font-size:14px}'
        + '.ok{color:#1b7a34}.bad{color:#b26b00}.broken{color:#b00020}'
        + 'table{border-collapse:collapse;width:100%;margin:6px 0 2px;font-size:13px}'
        + 'th,td{border:1px solid #e0d8ea;padding:5px 9px;text-align:left;white-space:nowrap}'
        + 'th{background:#f3eef7;font-weight:600}'
        + 'td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}'
        + 'tbody tr:nth-child(even){background:#faf8fc}'
        + '.mono{font-family:ui-monospace,Menlo,Consolas,monospace}'
        + '.note{color:#888;font-size:12px;font-style:italic;margin:2px 0 0}'
        + '.kv{font-size:13px;margin:2px 0}'
        + '</style></head><body>');

    // ---- header ----  (no <h1> title: the modal header already shows it)
    H.push('<div class="meta">');
    H.push('<div><b>Call-ID</b> <span class="mono">' + val(record && record.call_id) + '</span></div>');
    if (srv.sylk_session_id) H.push('<div><b>Session</b> <span class="mono">' + val(srv.sylk_session_id) + '</span></div>');
    const _date = (record && record.date) || srv.ended_at || null;
    if (_date) {
        let _d = _date; const _n = Number(_date);
        if (Number.isFinite(_n) && _n > 0) _d = new Date(_n < 1e12 ? _n * 1000 : _n).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
        H.push('<div><b>Date</b> ' + esc(_d) + '</div>');
    }
    if (record && (record.from_uri || record.to_uri)) {
        H.push('<div><b>From</b> ' + val(record.from_uri) + ' &nbsp; <b>To</b> ' + val(record.to_uri) + '</div>');
    }
    H.push('<div><b>Media</b> ' + (esc((srv.media_types || []).join(', ')) || '?')
        + ' &nbsp; <b>Duration</b> ' + (srv.duration_s != null ? esc(srv.duration_s) + 's' : '?') + '</div>');
    const ua = (srv.user_agents) || {};
    H.push('<div><b>Device</b> ' + (val(ua.local) !== '?' ? val(ua.local) : esc(userAgent)) + ' (this device)</div>');
    H.push('<div><b>Remote</b> ' + val(ua.remote) + '</div>');
    H.push('</div>');

    // ---- SERVER ----
    H.push('<h2>SylkServer statistics</h2>');
    H.push('<div class="verdict ' + vClass + '">' + esc(_stripCall(srv.evaluation_text || srv.evaluation || 'n/a')) + '</div>');
    if (w && Object.keys(w).length) {
        H.push('<h3>WebRTC media &middot; this device &harr; Janus</h3>');
        H.push(tbl([
            [mediaLabel, 'out', num(w.packets_client_to_server), val(w.client) + ' → ' + janus],
            [mediaLabel, 'in', num(w.packets_server_to_client), val(w.client) + ' ← ' + janus],
        ], [2]));
    }
    if (s && Object.keys(s).length) {
        H.push('<h3>SIP/RTP media &middot; Janus &harr; MediaProxy <span class="note">(caller-facing leg)</span></h3>');
        if (Array.isArray(s.streams) && s.streams.length) {
            H.push('<div class="kv">streams: ' + esc(s.streams.map((x) => (x.media || '?') + ' ' + (x.remote_ip || '?') + ':' + (x.remote_port || '?')).join(', ')) + '</div>');
        }
        H.push(tbl([
            [mediaLabel, 'out', num(s.packets_janus_to_mediaproxy), val(s.janus) + ' → ' + val(s.mediaproxy)],
            [mediaLabel, 'in', num(s.packets_mediaproxy_to_janus), val(s.janus) + ' ← ' + val(s.mediaproxy)],
        ], [2]));
    }

    // ---- CLIENT ----
    H.push('<h2>Blink statistics</h2>');
    H.push('<div class="verdict">' + (cli.domain ? esc(cli.domain + (cli.reason ? ' — ' + cli.reason : '')) : 'no data') + '</div>');
    if (cli.packetsSent != null) {
        const cpath = val(w.client);
        H.push(tbl([
            [mediaLabel, 'out', esc(cli.packetsSent), cpath + ' → ' + janus],
            [mediaLabel, 'in', esc(cli.packetsReceived), cpath + ' ← ' + janus],
        ], [2]));
        H.push('<div class="kv">ice ' + val(cli.iceState) + ' &middot; dtls ' + val(cli.dtlsState)
            + ' &middot; rtt ' + (cli.rttMs != null ? esc(cli.rttMs) + 'ms' : '?') + '</div>');
    }
    const fmt = (v, unit) => (v != null && v !== '?') ? (esc(v) + (unit || '')) : '?';
    if (cli.lossIn != null || cli.concealPct != null || cli.jbDelayMs != null) {
        H.push('<div class="kv">loss in ' + fmt(cli.lossIn, '%') + ' &middot; out ' + fmt(cli.lossOut, '%')
            + ' &middot; conceal ' + fmt(cli.concealPct, '%') + ' &middot; jitter ' + fmt(cli.jbDelayMs, 'ms')
            + ' &middot; flushes ' + fmt(cli.jbFlushes) + ' &middot; pps ' + fmt(cli.ppsRecv) + '</div>');
    }

    // ---- RECONCILIATION ----
    H.push('<h2>Reconciliation</h2>');
    const haveClient = !!(record && record.client && (record.client.domain
        || record.client.packetsSent != null || record.client.packetsReceived != null));
    const haveServer = !!(srv && (srv.evaluation || (srv.legs && Object.keys(srv.legs).length)));
    if (!haveClient && !haveServer) {
        H.push('<div class="kv">not possible &mdash; neither client nor server data available</div>');
    } else if (!haveClient) {
        H.push('<div class="kv">not possible without client data</div>');
    } else if (!haveServer) {
        H.push('<div class="kv">not possible without server data</div>');
    } else {
        const upLost = up.lost_client_to_server;
        H.push(tbl([
            ['dir', 'Blink', 'SylkServer', 'lost'],
            ['out', num(up.client_sent), num(up.server_received), num(upLost)],
            ['in', num(down.client_received), num(down.server_sent), num(down.lost_server_to_client)],
        ], [1, 2, 3], true));
        if (typeof upLost === 'number' && upLost < 0) {
            H.push('<div class="note">negative uplink loss = RTCP/STUN + timing, not real loss</div>');
        }
        H.push('<div class="kv"><b>client</b> ' + val(r.client_verdict) + '</div>');
        H.push('<div class="kv"><b>server</b> ' + esc(_stripCall(r.server_verdict || '?')) + '</div>');
        H.push('<div class="kv"><b>agreement</b> ' + (r.agree == null ? 'n/a' : (r.agree ? 'AGREE' : 'DISAGREE')) + '</div>');
    }

    H.push('</body></html>');
    return H.join('');
}

/**
 * Reconcile the server-side qos summary with the client's measured packet
 * counts and log the differences + verdicts. Pure (no `this`) so it lives here
 * in the leaf module — editing it Fast-Refreshes instead of full-reloading
 * app.js. Returns the reconciliation object (also saved in .qos.json).
 *
 * Direction semantics:
 *   out / uplink   (client → server): client sent N, server received M -> N-M lost
 *   in  / downlink (server → client): server sent P, client received Q -> P-Q lost
 * Received is clamped to never exceed sent (server tcpdump also counts
 * RTCP/STUN, so a tally can edge above the matching RTP-only count) — no
 * negative loss either way.
 */
export function reconcileQos(callid, summary, client) {
    const num = (v) => (typeof v === 'number' ? v : (v == null ? 0 : (parseInt(v, 10) || 0)));
    const legs = (summary && summary.legs) || {};
    const w = legs.webrtc || {};
    let srvFromClient = num(w.packets_client_to_server);     // server received from client (uplink)
    const srvToClient = num(w.packets_server_to_client);     // server sent to client (downlink)
    const serverVerdict = (summary && (summary.evaluation_text || summary.evaluation)) || 'unknown';
    const serverOk = summary ? summary.media_ok === true : null;

    const haveClient = !!(client && client.packetsSent != null);
    const cliSent = haveClient ? num(client.packetsSent) : null;       // uplink
    let cliRecv = haveClient ? num(client.packetsReceived) : null;     // downlink
    const clientVerdict = haveClient
        ? (client.domain + (client.reason ? ' (' + client.reason + ')' : ''))
        : 'no client data';
    const clientOk = haveClient ? (client.domain === 'OK') : null;

    // Can't receive more than was sent — clamp both ways.
    if (cliSent != null && srvFromClient > cliSent) srvFromClient = cliSent;
    if (cliRecv != null && cliRecv > srvToClient) cliRecv = srvToClient;

    const uplinkLost = (cliSent != null) ? (cliSent - srvFromClient) : null;
    const downlinkLost = (cliRecv != null) ? (srvToClient - cliRecv) : null;
    const agree = (clientOk != null && serverOk != null) ? (clientOk === serverOk) : null;

    const recon = {
        uplink: { client_sent: cliSent, server_received: srvFromClient, lost_client_to_server: uplinkLost },
        downlink: { server_sent: srvToClient, client_received: cliRecv, lost_server_to_client: downlinkLost },
        client_verdict: clientVerdict,
        server_verdict: serverVerdict,
        agree,
    };

    console.log(`[qos] reconcile call ${callid}`);
    console.log(`[qos] reconcile   uplink   client_sent=${cliSent} server_recv=${srvFromClient} lost(c->s)=${uplinkLost}`);
    console.log(`[qos] reconcile   downlink server_sent=${srvToClient} client_recv=${cliRecv} lost(s->c)=${downlinkLost}`);
    console.log(`[qos] reconcile   client verdict: ${clientVerdict}`);
    console.log(`[qos] reconcile   server verdict: ${serverVerdict}`);
    console.log(`[qos] reconcile   agreement: ${agree == null ? 'n/a' : (agree ? 'AGREE' : 'DISAGREE')}`);
    return recon;
}

/** One compact, grep-able [qos] [summary] line for the applog. Pure. */
export function qosSummaryLine(record) {
    const r = (record && record.reconciliation) || {};
    const up = r.uplink || {};
    const down = r.downlink || {};
    const srv = (record && record.server) || {};
    const cli = record && record.client;
    return [
        `call=${record && record.call_id}`,
        `media=${(srv.media_types || []).join('/') || '?'}`,
        `client[sent=${up.client_sent} recv=${down.client_received} verdict=${(cli && cli.domain) || 'n/a'}]`,
        `server[c->s=${up.server_received} s->c=${down.server_sent} verdict=${srv.evaluation || 'n/a'}]`,
        `lost[c->s=${up.lost_client_to_server} s->c=${down.lost_server_to_client}]`,
        `agreement=${r.agree == null ? 'n/a' : (r.agree ? 'AGREE' : 'DISAGREE')}`,
    ].join(' ');
}
