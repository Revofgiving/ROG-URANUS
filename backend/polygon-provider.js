const { ethers } = require('ethers');

function parseRpcUrls() {
  const urls = [];

  if (process.env.POLYGON_RPC_URLS) {
    process.env.POLYGON_RPC_URLS.split(',').forEach(u => {
      const v = (u || '').trim();
      if (v) urls.push(v);
    });
  }

  if (process.env.POLYGON_RPC_URL) {
    const v = process.env.POLYGON_RPC_URL.trim();
    if (v) urls.push(v);
  }

  // Fallback pubblici (non garantiti):
  urls.push('https://rpc.ankr.com/polygon');
  urls.push('https://polygon.llamarpc.com');
  urls.push('https://polygon-bor-rpc.publicnode.com');
  urls.push('https://polygon-rpc.com/');

  // Dedup
  return [...new Set(urls)];
}

async function getPolygonProvider() {
  const urls = parseRpcUrls();
  let lastErr;

  for (const url of urls) {
    try {
      const p = new ethers.providers.JsonRpcProvider(url);
      // Smoke test
      await p.getBlockNumber();
      return p;
    } catch (err) {
      lastErr = err;
    }
  }

  const msg = lastErr && (lastErr.message || lastErr.toString());
  throw new Error(`No working Polygon RPC found. Last error: ${msg}`);
}

module.exports = { getPolygonProvider, parseRpcUrls };
