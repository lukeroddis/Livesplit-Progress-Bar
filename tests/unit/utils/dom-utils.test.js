/**
 * tests/unit/utils/dom-utils.test.js
 * Unit tests for LiveSplit.DOMUtils sanitization and security helpers
 */

(function () {
  "use strict";

  describe("DOM Sanitization & Security: LiveSplit.DOMUtils", () => {
    it("exports complete public API on window.LiveSplit.DOMUtils and window.escapeHtml", () => {
      const du = window.LiveSplit.DOMUtils;
      assert(du !== undefined && du !== null, "DOMUtils is exposed on window.LiveSplit");
      assertEqual(typeof du.escapeHtml, "function", "escapeHtml is a function");
      assertEqual(typeof du.isSafeUrl, "function", "isSafeUrl is a function");
      assertEqual(typeof du.isSafeAvatarUrl, "function", "isSafeAvatarUrl is a function");
      assertEqual(typeof du.buildAvatarMarkup, "function", "buildAvatarMarkup is a function");
      assertEqual(typeof window.escapeHtml, "function", "escapeHtml is exported globally on window");
    });

    it("escapeHtml escapes HTML entities and handles diverse input types", () => {
      const du = window.LiveSplit.DOMUtils;
      assertEqual(du.escapeHtml('hello & <world> "test" \'quote\''), 'hello &amp; &lt;world&gt; &quot;test&quot; &#039;quote&#039;');
      assertEqual(du.escapeHtml(""), "");
      assertEqual(du.escapeHtml(null), "");
      assertEqual(du.escapeHtml(undefined), "");
      assertEqual(du.escapeHtml(12345), "12345");
      assertEqual(du.escapeHtml(0), "0");
      assertEqual(du.escapeHtml(false), "false");
    });

    it("isSafeUrl accepts valid secure remote URLs and data image URIs", () => {
      const du = window.LiveSplit.DOMUtils;
      assertEqual(du.isSafeUrl("https://example.com/avatar.png"), true);
      assertEqual(du.isSafeUrl("http://example.com/pic.jpg"), true);
      assertEqual(du.isSafeUrl("HTTPS://EXAMPLE.COM/PHOTO.GIF"), true, "Case-insensitive scheme check");
      assertEqual(du.isSafeUrl("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="), true);
    });

    it("isSafeUrl rejects malicious schemes and invalid data types", () => {
      const du = window.LiveSplit.DOMUtils;
      assertEqual(du.isSafeUrl("javascript:alert(1)"), false, "Rejects javascript:");
      assertEqual(du.isSafeUrl("vbscript:msgbox(1)"), false, "Rejects vbscript:");
      assertEqual(du.isSafeUrl("file:///C:/passwords.txt"), false, "Rejects file:");
      assertEqual(du.isSafeUrl("data:text/html,<script>alert(1)</script>"), false, "Rejects non-image data URI");
      assertEqual(du.isSafeUrl(""), false);
      assertEqual(du.isSafeUrl(null), false);
      assertEqual(du.isSafeUrl(undefined), false);
      assertEqual(du.isSafeUrl(12345), false);
      assertEqual(du.isSafeUrl({ url: "https://example.com" }), false);
    });

    it("buildAvatarMarkup renders sanitized <img> tags for safe URLs", () => {
      const du = window.LiveSplit.DOMUtils;
      const html1 = du.buildAvatarMarkup("https://therun.gg/avatar.png?user=foo&tag=bar");
      assertEqual(html1, '<img class="racer-avatar-img" src="https://therun.gg/avatar.png?user=foo&amp;tag=bar" alt="" />');

      // Custom img class option
      const html2 = du.buildAvatarMarkup("https://example.com/pic.png", "🏎️", { imgClass: "custom-avatar-class" });
      assertEqual(html2, '<img class="custom-avatar-class" src="https://example.com/pic.png" alt="" />');
    });

    it("buildAvatarMarkup falls back to emoji badge for text, emoji, or rejected URLs", () => {
      const du = window.LiveSplit.DOMUtils;
      // Normal emoji
      const htmlEmoji = du.buildAvatarMarkup("🦊");
      assertEqual(htmlEmoji, '<span class="racer-avatar-emoji">🦊</span>');

      // Malicious scheme blocked from becoming img
      const htmlXSS = du.buildAvatarMarkup('javascript:alert("pwned")', "🏎️");
      assertEqual(htmlXSS, '<span class="racer-avatar-emoji">🏎️</span>', "Blocked javascript URL falls back to default icon");

      // Custom emoji class
      const htmlCustom = du.buildAvatarMarkup("🚀", "🏎️", { emojiClass: "ghost-icon racer-avatar" });
      assertEqual(htmlCustom, '<span class="ghost-icon racer-avatar">🚀</span>');
    });
  });
})();
