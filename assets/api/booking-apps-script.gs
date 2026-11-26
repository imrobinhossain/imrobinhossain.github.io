/**
 * Private Google Apps Script Web App for Robin Hossain's Portfolio Booking Form.
 *
 * Deployment steps (1 minute):
 * 1. Open https://script.google.com under a personal @gmail.com account
 *    (do NOT deploy under an @cutebd.biz Google account — cutebd.biz uses
 *    Microsoft 365 SPF "-all" which rejects mail sent via Google servers).
 * 2. Replace the default Code.gs contents with this entire file and save.
 * 3. Click "Deploy" -> "New deployment" (or "Manage deployments" -> Edit) -> "Web app".
 *    - Description: Portfolio Booking Emailer
 *    - Execute as: Me
 *    - Who has access: Anyone   <-- REQUIRED so public browsers do not get HTTP 403
 * 4. Click "Deploy", authorize Gmail/Script permissions, and copy the Web App URL.
 * 5. Paste that URL into `window.BOOKING_CONFIG.appsScriptUrl` in `script.js`.
 */

const RECIPIENT_EMAIL = "robin.hossain@cutebd.biz";
const SEQUENCE_PROPERTY_KEY = "BOOKING_SEQ";

function doGet() {
  return jsonResponse({
    ok: true,
    service: "Portfolio Booking Endpoint"
  });
}

function doPost(e) {
  try {
    const payload = parseRequestPayload(e);
    const name = sanitizeSingleLine(payload.name, 200);
    const email = sanitizeSingleLine(payload.email, 254);
    const agenda = sanitizeMultiLine(payload.agenda, 4000);
    const date = sanitizeSingleLine(payload.date, 40);
    const dayDate = sanitizeSingleLine(payload.dayDate, 100) || formatDateWithDay(date);
    const time = sanitizeSingleLine(payload.time, 40);
    const timezone = sanitizeSingleLine(payload.timezone, 100) || "Asia/Dhaka";
    const platform = sanitizeSingleLine(payload.platform, 40);

    if (!name || !isValidEmail(email) || !agenda || !date || !time) {
      return jsonResponse({
        ok: false,
        error: "Please fill in all required booking fields."
      });
    }

    if (platform !== "Google Meet" && platform !== "Zoom") {
      return jsonResponse({
        ok: false,
        error: "Invalid meeting platform selected."
      });
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);

    try {
      const props = PropertiesService.getScriptProperties();
      const lastSeq = parseInt(props.getProperty(SEQUENCE_PROPERTY_KEY) || "0", 10);
      const nextSeq = Number.isFinite(lastSeq) && lastSeq >= 0 ? lastSeq + 1 : 1;
      const bookingNumber = "#" + String(nextSeq).padStart(3, "0");

      const subject = `Booking Details ${bookingNumber} - ${name} (${platform})`;
      const body = [
        "Booking Details",
        "",
        `Name: ${name}`,
        `Email: ${email}`,
        `Time Slot: ${time} — ${dayDate} (${timezone})`,
        `Preferred Platform: ${platform}`,
        `Agenda: ${agenda}`
      ].join("\n");

      const safeDisplayName = name.replace(/[<>"()@\r\n]/g, "").trim() || "Booking Visitor";
      const htmlBody = [
        `<p><strong>Booking Details</strong></p>`,
        `<p>`,
        `<strong>Name:</strong> ${escapeHtml(name)}<br>`,
        `<strong>Email:</strong> ${escapeHtml(email)}<br>`,
        `<strong>Time Slot:</strong> ${escapeHtml(time)} &mdash; ${escapeHtml(dayDate)} (${escapeHtml(timezone)})<br>`,
        `<strong>Preferred Platform:</strong> ${escapeHtml(platform)}<br>`,
        `<strong>Agenda:</strong> ${escapeHtml(agenda).replace(/\n/g, "<br>")}`,
        `</p>`
      ].join("");

      MailApp.sendEmail({
        to: RECIPIENT_EMAIL,
        replyTo: email,
        name: `Portfolio Booking - ${safeDisplayName}`,
        subject: subject,
        body: body,
        htmlBody: htmlBody
      });

      props.setProperty(SEQUENCE_PROPERTY_KEY, String(nextSeq));

      return jsonResponse({
        ok: true,
        bookingNumber: bookingNumber
      });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: err && err.message ? err.message : "Failed to process booking."
    });
  }
}

function parseRequestPayload(e) {
  if (e && e.postData && typeof e.postData.contents === "string" && e.postData.contents.trim()) {
    try {
      const parsed = JSON.parse(e.postData.contents);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch (_) {
      // Fall back to form parameters below.
    }
  }
  return (e && e.parameter) ? e.parameter : {};
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function sanitizeSingleLine(value, maxLength) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeMultiLine(value, maxLength) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function formatDateWithDay(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return dateStr;
  const dateObj = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(dateObj.getTime())) return dateStr;
  return Utilities.formatDate(dateObj, Session.getScriptTimeZone() || "Asia/Dhaka", "EEEE, MMMM d, yyyy");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Optional helper: run manually in Apps Script editor to test delivery to RECIPIENT_EMAIL.
 */
function testBookingEmail() {
  MailApp.sendEmail({
    to: RECIPIENT_EMAIL,
    name: "Portfolio Booking - Test",
    subject: "Test Booking Delivery",
    body: "This is a delivery test from Portfolio Booking Apps Script."
  });
}

/**
 * Optional helper: run manually in Apps Script editor to reset the sequence counter.
 */
function resetBookingSequence(startAfterNumber) {
  const value = Math.max(0, parseInt(startAfterNumber || "0", 10) || 0);
  PropertiesService.getScriptProperties().setProperty(SEQUENCE_PROPERTY_KEY, String(value));
}
