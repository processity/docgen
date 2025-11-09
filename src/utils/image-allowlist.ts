import { createLogger } from './logger';

const logger = createLogger('utils:image-allowlist');

/**
 * Image allowlist validator
 *
 * Per architecture:
 * - Base64 images are preferred (no URL validation needed)
 * - External image URLs must be on the allowlist
 * - Allowlist is configured via IMAGE_ALLOWLIST env var (comma-separated domains)
 *
 * Security:
 * - Prevents SSRF attacks via template-injected URLs
 * - Enforces allowlist of trusted CDN/image hosts
 */
export class ImageAllowlist {
  private allowedDomains: Set<string>;

  constructor(allowlist: string[] = []) {
    this.allowedDomains = new Set(allowlist.map((domain) => domain.toLowerCase().trim()));

    logger.info(
      { allowedDomains: Array.from(this.allowedDomains) },
      'Image allowlist initialized'
    );
  }

  /**
   * Check if an image URL is allowed
   *
   * @param url - Image URL to validate
   * @returns true if allowed, false otherwise
   */
  isAllowed(url: string): boolean {
    // Empty allowlist means no external URLs allowed
    if (this.allowedDomains.size === 0) {
      logger.warn({ url }, 'Image URL rejected: allowlist is empty');
      return false;
    }

    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();

      // Check exact match or subdomain match
      const allowed = this.isHostnameAllowed(hostname);

      if (!allowed) {
        logger.warn({ url, hostname, allowlist: Array.from(this.allowedDomains) }, 'Image URL rejected: not in allowlist');
      } else {
        logger.debug({ url, hostname }, 'Image URL allowed');
      }

      return allowed;
    } catch (error) {
      logger.error({ url, error }, 'Invalid image URL');
      return false;
    }
  }

  /**
   * Check if hostname is allowed (exact match or subdomain)
   *
   * Examples:
   * - Allowlist: ["example.com"]
   * - Allowed: "example.com", "www.example.com", "cdn.example.com"
   * - Not allowed: "evil-example.com", "examplecom.evil"
   */
  private isHostnameAllowed(hostname: string): boolean {
    // Check exact match
    if (this.allowedDomains.has(hostname)) {
      return true;
    }

    // Check if hostname is a subdomain of any allowed domain
    for (const allowedDomain of this.allowedDomains) {
      if (hostname.endsWith('.' + allowedDomain)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Validate multiple URLs at once
   *
   * @param urls - Array of URLs to validate
   * @returns Object with allowed and rejected URLs
   */
  validateUrls(urls: string[]): { allowed: string[]; rejected: string[] } {
    const allowed: string[] = [];
    const rejected: string[] = [];

    for (const url of urls) {
      if (this.isAllowed(url)) {
        allowed.push(url);
      } else {
        rejected.push(url);
      }
    }

    return { allowed, rejected };
  }

  /**
   * Get list of allowed domains
   */
  getAllowedDomains(): string[] {
    return Array.from(this.allowedDomains);
  }
}
