/**
 * 通用 OpenAI 兼容 Provider
 * 支持本地 llama.cpp server（OpenAI 兼容 API）和云端 API（DeepSeek/OpenAI 等）
 */
const AIProvider = require('../ai-provider');
const http = require('http');
const https = require('https');

class GenericProvider extends AIProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'generic';
    this.baseURL = config.baseURL || 'http://127.0.0.1:8080/v1';
    this.apiKey = config.apiKey || 'not-needed';
    this.model = config.model || 'local-model';
  }

  async chat({ messages, tools }) {
    return this._request('/chat/completions', {
      model: this.model, messages, tools,
      stream: false, temperature: 0.7
    });
  }

  async _request(path, body) {
    const url = new URL(this.baseURL + path);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = client.request({
        hostname: url.hostname, port: url.port, path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: 120000
      }, (res) => {
        let buf = '';
        res.on('data', c => buf += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(buf);
            const choice = json.choices?.[0];
            const msg = choice?.message || {};
            resolve({
              content: msg.content || '',
              toolCalls: (msg.tool_calls || []).map(tc => ({
                id: tc.id, name: tc.function?.name,
                args: JSON.parse(tc.function?.arguments || '{}')
              }))
            });
          } catch (e) { reject(new Error('Parse error: ' + e.message + ' body: ' + buf.slice(0, 200))); }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  async checkConnection() {
    try {
      const url = new URL(this.baseURL + '/models');
      const client = url.protocol === 'https:' ? https : http;
      return new Promise((resolve) => {
        const req = client.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: 'GET', timeout: 5000 },
          (res) => resolve({ ok: res.statusCode < 400, status: res.statusCode }));
        req.on('error', e => resolve({ ok: false, error: e.message }));
        req.end();
      });
    } catch (e) { return { ok: false, error: e.message }; }
  }
}
module.exports = GenericProvider;
