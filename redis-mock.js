import net from 'node:net';

const store = new Map();
const expires = new Map();

function checkExpire(key) {
  const exp = expires.get(key);
  if (exp && Date.now() > exp) {
    store.delete(key);
    expires.delete(key);
    return true;
  }
  return false;
}

function encodeBulk(v) {
  if (v == null) return '$-1\r\n';
  const s = String(v);
  return `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
}

function encodeArray(items) {
  let r = `*${items.length}\r\n`;
  for (const i of items) {
    if (i === null) r += '$-1\r\n';
    else if (Array.isArray(i)) r += encodeArray(i);
    else r += encodeBulk(i);
  }
  return r;
}

function handle(args) {
  const cmd = args[0].toUpperCase();
  console.log('[CMD]', cmd, args.slice(1).map(a => a.length > 50 ? a.slice(0, 50) + '...' : a).join(' '));
  switch (cmd) {
    case 'PING': return '+PONG\r\n';
    case 'GET': {
      const k = args[1];
      checkExpire(k);
      const v = store.get(k);
      return v !== undefined ? encodeBulk(v) : '$-1\r\n';
    }
    case 'SET': {
      store.set(args[1], args[2]);
      if (args[3]?.toUpperCase() === 'EX') {
        expires.set(args[1], Date.now() + parseInt(args[4]) * 1000);
      }
      return '+OK\r\n';
    }
    case 'DEL': {
      let c = 0;
      for (let i = 1; i < args.length; i++) {
        if (store.has(args[i])) {
          store.delete(args[i]);
          expires.delete(args[i]);
          c++;
        }
      }
      return `:${c}\r\n`;
    }
    case 'KEYS': {
      const r = new RegExp('^' + args[1].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      const ks = [];
      for (const k of store.keys()) {
        if (!checkExpire(k) && r.test(k)) ks.push(k);
      }
      return encodeArray(ks);
    }
    case 'INFO': {
      const info = [
        '# Server',
        'redis_version:7.2.0',
        'redis_mode:standalone',
        'os:Linux',
        'arch_bits:64',
        '# Clients',
        'connected_clients:1',
        '# Memory',
        'used_memory:1000000',
        '# Persistence',
        'loading:0',
        'rdb_bgsave_in_progress:0',
        '# Stats',
        'total_connections_received:1',
        '# Replication',
        'role:master',
        '# CPU',
        'used_cpu_sys:0.1',
        '',
      ].join('\r\n');
      return encodeBulk(info);
    }
    case 'CLIENT': return '+OK\r\n';
    case 'CONFIG': case 'COMMAND': case 'SELECT': case 'AUTH': case 'QUIT': return '+OK\r\n';
    case 'ROLE': return encodeArray(['master', 0, []]);
    case 'HELLO': return encodeArray(['server', 'redis', 'version', '7.2.0', 'proto', 2]);
    case 'EXISTS': {
      let c = 0;
      for (let i = 1; i < args.length; i++) {
        if (!checkExpire(args[i]) && store.has(args[i])) c++;
      }
      return `:${c}\r\n`;
    }
    case 'TTL': {
      const k = args[1];
      if (checkExpire(k) || !store.has(k)) return ':-2\r\n';
      const e = expires.get(k);
      if (!e) return ':-1\r\n';
      return `:${Math.ceil((e - Date.now()) / 1000)}\r\n`;
    }
    case 'SCAN': {
      const cursor = parseInt(args[1]) || 0;
      const pattern = args[2] === 'MATCH' ? args[3] : '*';
      const r = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      const ks = [];
      for (const k of store.keys()) {
        if (!checkExpire(k) && r.test(k)) ks.push(k);
      }
      return encodeArray(['0', ks]);
    }
    default: return '+OK\r\n';
  }
}

function parse(buf) {
  const cmds = [];
  let i = 0;
  const CRLF = Buffer.from('\r\n');
  while (i < buf.length) {
    if (buf[i] !== 0x2a) break; // '*'
    const j = buf.indexOf(CRLF, i);
    if (j === -1) break;
    const count = parseInt(buf.slice(i + 1, j).toString());
    i = j + 2;
    const args = [];
    let ok = true;
    for (let k = 0; k < count; k++) {
      if (buf[i] !== 0x24) { ok = false; break; } // '$'
      const l = buf.indexOf(CRLF, i);
      if (l === -1) { ok = false; break; }
      const len = parseInt(buf.slice(i + 1, l).toString());
      i = l + 2;
      if (i + len > buf.length) { ok = false; break; }
      args.push(buf.slice(i, i + len).toString());
      i += len + 2;
    }
    if (!ok) break;
    cmds.push(args);
  }
  return { cmds, consumed: i };
}

const server = net.createServer((socket) => {
  console.log('[CONN] 新连接');
  let buf = Buffer.alloc(0);
  socket.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    const { cmds, consumed } = parse(buf);
    if (consumed > 0) buf = buf.subarray(consumed);
    for (const c of cmds) {
      const resp = handle(c);
      socket.write(resp);
    }
  });
  socket.on('error', (e) => console.log('[SOCK ERR]', e.message));
  socket.on('close', () => console.log('[CONN] 关闭'));
});

server.listen(6379, () => console.log('[Mock v8] started on 6379 (RESP2)'));
