<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9">
  <xsl:output method="html" encoding="UTF-8" indent="yes"/>
  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charSet="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title>Sitemap — Lambda Prep</title>
        <style>
          :root {
            --background: #ffffff;
            --foreground: #171b2e;
            --primary: #0066ff;
            --primary-deep: #003cd2;
            --muted: #f6f8fc;
            --muted-foreground: #5b6478;
            --border: #e4e8f0;
            --card: #ffffff;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            font-family: 'DM Sans', 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: var(--background);
            color: var(--foreground);
          }
          .wrap { max-width: 900px; margin: 0 auto; padding: 56px 24px 80px; }
          .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 36px; }
          .brand-mark {
            width: 36px; height: 36px; border-radius: 10px;
            background: linear-gradient(135deg, var(--primary), var(--primary-deep));
            display: flex; align-items: center; justify-content: center;
            color: #fff; font-weight: 700; font-size: 18px; flex-shrink: 0;
          }
          .brand-name { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
          .brand-name .period { color: var(--primary); }
          h1 { font-size: 30px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 8px; }
          .subtitle { color: var(--muted-foreground); font-size: 14px; margin: 0 0 32px; }
          .subtitle strong { color: var(--foreground); font-weight: 600; }
          table { width: 100%; border-collapse: collapse; border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
          thead th {
            text-align: left; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase;
            color: var(--muted-foreground); font-weight: 600; padding: 14px 18px; background: var(--muted);
            border-bottom: 1px solid var(--border);
          }
          tbody td { padding: 14px 18px; font-size: 14px; border-bottom: 1px solid var(--border); vertical-align: middle; }
          tbody tr:last-child td { border-bottom: none; }
          tbody tr:hover { background: var(--muted); }
          .url-link { color: var(--primary); text-decoration: none; font-weight: 550; word-break: break-all; }
          .url-link:hover { text-decoration: underline; }
          .priority-pill {
            display: inline-flex; align-items: center; justify-content: center;
            min-width: 44px; padding: 3px 10px; border-radius: 999px;
            font-size: 12px; font-weight: 600; background: var(--muted); color: var(--foreground);
            border: 1px solid var(--border);
          }
          .priority-high { background: rgba(0,102,255,0.1); color: var(--primary-deep); border-color: rgba(0,102,255,0.25); }
          .freq { color: var(--muted-foreground); font-size: 13px; text-transform: capitalize; }
          .footer-note { margin-top: 28px; font-size: 12px; color: var(--muted-foreground); text-align: center; }
          .footer-note a { color: var(--primary); text-decoration: none; }
          .footer-note a:hover { text-decoration: underline; }
          @media (max-width: 640px) {
            .wrap { padding: 32px 16px 56px; }
            table, thead, tbody, th, td, tr { display: block; }
            thead { display: none; }
            tbody tr { border-bottom: 1px solid var(--border); padding: 14px 18px; }
            tbody tr:last-child { border-bottom: none; }
            tbody td { border-bottom: none; padding: 4px 0; }
            tbody td:first-child { font-weight: 600; }
          }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="brand">
            <span class="brand-mark">λ</span>
            <span class="brand-name">lambda<span class="period">.</span></span>
          </div>
          <h1>XML Sitemap</h1>
          <p class="subtitle">
            <xsl:text>This sitemap lists </xsl:text>
            <strong><xsl:value-of select="count(sm:urlset/sm:url)"/></strong>
            <xsl:text> pages Lambda Prep submits to search engines.</xsl:text>
          </p>
          <table>
            <thead>
              <tr>
                <th>URL</th>
                <th>Priority</th>
                <th>Change frequency</th>
              </tr>
            </thead>
            <tbody>
              <xsl:for-each select="sm:urlset/sm:url">
                <xsl:sort select="sm:priority" order="descending"/>
                <tr>
                  <td>
                    <a class="url-link" href="{sm:loc}"><xsl:value-of select="sm:loc"/></a>
                  </td>
                  <td>
                    <xsl:choose>
                      <xsl:when test="number(sm:priority) &gt;= 0.8">
                        <span class="priority-pill priority-high"><xsl:value-of select="sm:priority"/></span>
                      </xsl:when>
                      <xsl:otherwise>
                        <span class="priority-pill"><xsl:value-of select="sm:priority"/></span>
                      </xsl:otherwise>
                    </xsl:choose>
                  </td>
                  <td>
                    <span class="freq"><xsl:value-of select="sm:changefreq"/></span>
                  </td>
                </tr>
              </xsl:for-each>
            </tbody>
          </table>
          <p class="footer-note">
            Generated for <a href="https://project-3354c0eb.eazo.dev/">Lambda Prep</a> — curated ICSE &amp; ISC study resources.
          </p>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
