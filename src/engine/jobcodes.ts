// PBJ job codes (CMS Payroll-Based Journal Policy Manual and data specifications) and a
// title-to-code guesser for the free-text job titles that time clocks export.

export const JOB_CODES: Record<number, string> = {
  1: 'Administrator',
  2: 'Medical Director',
  3: 'Other Physician',
  4: 'Physician Assistant',
  5: 'Registered Nurse Director of Nursing',
  6: 'Registered Nurse with Administrative Duties',
  7: 'Registered Nurse',
  8: 'Licensed Practical/Vocational Nurse with Administrative Duties',
  9: 'Licensed Practical/Vocational Nurse',
  10: 'Certified Nurse Aide',
  11: 'Nurse Aide in Training',
  12: 'Medication Aide/Technician',
  13: 'Nurse Practitioner',
  14: 'Clinical Nurse Specialist',
  15: 'Pharmacist',
  16: 'Dietitian',
  17: 'Paid Feeding Assistant',
  18: 'Occupational Therapist',
  19: 'Occupational Therapy Assistant',
  20: 'Occupational Therapy Aide',
  21: 'Physical Therapist',
  22: 'Physical Therapy Assistant',
  23: 'Physical Therapy Aide',
  24: 'Respiratory Therapist',
  25: 'Respiratory Therapy Technician',
  26: 'Speech/Language Pathologist',
  27: 'Therapeutic Recreation Specialist',
  28: 'Qualified Activities Professional',
  29: 'Other Activities Staff',
  30: 'Qualified Social Worker',
  31: 'Other Social Worker',
  32: 'Dietary Aide',
  33: 'Housekeeping',
  34: 'Maintenance',
  35: 'Other Service Worker',
  36: 'Mental Health Service Worker',
  37: 'Other',
  38: 'Medical Records',
  39: 'Other Admin Staff',
  40: 'Clinical Laboratory Service Worker',
}

export const SHORT_CODE: Record<number, string> = { 5: 'RN DON', 6: 'RN admin', 7: 'RN', 8: 'LPN admin', 9: 'LPN', 10: 'CNA', 11: 'NA in training', 12: 'Med aide' }

export const isNursing = (c: number | null) => c !== null && c >= 5 && c <= 12

// Order matters: the first rule that matches wins, so specific titles come before generic ones.
const RULES: [RegExp, number][] = [
  [/\b(d\.?o\.?n|director of nursing|dir(ector)?\.? nurs)/i, 5],
  [/\bnursing home admin|\badministrator\b|\bnha\b|executive director/i, 1],
  [/medical director/i, 2],
  [/\b(nurse practitioner|aprn|np)\b/i, 13],
  [/\b(physician assistant|pa-c)\b/i, 4],
  [/\b(lpn|lvn|licensed (practical|vocational))\b.*\b(admin|supervisor|manager|mds|coordinator|unit manager)|\b(admin|supervisor|manager|mds|coordinator)\b.*\b(lpn|lvn)\b/i, 8],
  [/\b(adon|assistant director|rn\b.*\b(admin|supervisor|manager|mds|coordinator|educator|staff dev|infection prevent|wound|unit manager))|\b(mds|staff development|infection prevent|unit manager|nurse manager|clinical coordinator)\b.*\brn\b/i, 6],
  [/\b(lpn|lvn|licensed (practical|vocational))\b/i, 9],
  [/\b(rn|registered nurse)\b|charge nurse/i, 7],
  [/\b(nurse aide in training|na in training|cna trainee|aide trainee|natp|nat\b|temporary nurse aide|tna)\b/i, 11],
  [/\b(med(ication)? (aide|tech)|cma|qma|kma|rma)\b/i, 12],
  [/\b(cna|c\.n\.a|certified nurs(e|ing) (aide|assistant)|nurse aide|nursing assistant|stna|lna|gna|cena)\b/i, 10],
  [/feeding assist/i, 17],
  [/\b(occupational therap(ist|y)|\bot\b|otr)\b/i, 18],
  [/\b(physical therap(ist|y)|\bpt\b|dpt)\b/i, 21],
  [/\b(speech|slp)\b/i, 26],
  [/\b(social work|msw|lcsw)\b/i, 30],
  [/\b(activit)/i, 29],
  [/\b(dietitian|rd\b|registered dietitian)\b/i, 16],
  [/\b(dietary|cook|kitchen|food service)\b/i, 32],
  [/\b(housekeep|laundry|environmental)\b/i, 33],
  [/\b(maintenance|plant ops)\b/i, 34],
  [/\b(medical records|him)\b/i, 38],
  [/\b(receptionist|clerk|scheduler|staffing coord|business office|payroll|hr|human resources|admissions)\b/i, 39],
]

/** Guess a PBJ job code from a title. Numeric codes pass through. Null when unknown. */
export function guessCode(title: string): number | null {
  const t = title.trim()
  if (/^\d{1,2}$/.test(t)) { const n = +t; return JOB_CODES[n] ? n : null }
  for (const [re, code] of RULES) if (re.test(t)) return code
  return null
}
