/**
 * 网络守卫 - 限制 agent 的网络访问
 */
class NetGuard {
  constructor() { this.allowedDomains = []; this.blockedDomains = []; }
  allow(domain) { this.allowedDomains.push(domain); }
  block(domain) { this.blockedDomains.push(domain); }
  isAllowed(url) {
    try {
      const u = new URL(url);
      if (this.blockedDomains.some(d => u.hostname.includes(d))) return false;
      if (this.allowedDomains.length === 0) return true;
      return this.allowedDomains.some(d => u.hostname.includes(d));
    } catch (e) { return false; }
  }
}
module.exports = NetGuard;
