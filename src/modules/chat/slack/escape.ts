/**
 * Hub text is plain; Slack's mrkdwn treats these three characters as syntax. The one markup a Hub message
 * carries is a mention or channel the member picked (`<@U123>`, `<#C123>`), kept so Slack makes it a real one,
 * and the formatting markers they typed or applied (`*bold*`, backticks, a leading `> `), which are not escaped, and
 * a web or mail link (`<https://x|label>`); anything else in angle brackets, `<!channel>` included, is escaped like the rest.
 */
export function escapeForSlack(text: string): string {
  // A `>` that starts a line is a quote, which Slack only reads unescaped; no other markup can start with one.
  return text.replace(/<(@[A-Z0-9]+|#[A-Z0-9]+)>|<((?:https?:\/\/|mailto:)[^\s<>|]+(?:\|[^<>|]*)?)>|(^>)|[&<>]/gm, (match, token?: string, link?: string, quote?: string) => {
    if (token || quote) return match;
    // A web or mail link the member made with the toolbar (or typed): `<address|label>`. Its own `&` is still escaped.
    if (link) return `<${link.replace(/&/g, "&amp;")}>`;
    return match === "&" ? "&amp;" : match === "<" ? "&lt;" : "&gt;";
  });
}
