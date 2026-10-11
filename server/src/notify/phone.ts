/**
 * Normalise a Mauritian mobile number to E.164 (+2305XXXXXXX).
 * Mobiles are 8 digits starting with 5. Landlines (7 digits) can't receive SMS/WhatsApp.
 * Accepts "5712 3456", "+230 5712 3456", "00230 57123456", "230-5712-3456".
 */
export function normaliseMuMobile(input: string): string | null {
  let digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('230')) digits = digits.slice(3);
  if (!/^5\d{7}$/.test(digits)) return null;
  return `+230${digits}`;
}
