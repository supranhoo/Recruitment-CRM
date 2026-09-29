/** Position status and TAT rules, matching the tracker's formulas and Policy 20.1. */
function tatContext_() {
  const grades = {};
  readTable_('M_Grades').rows.forEach(function (g) { grades[String(g.Grade).trim().toUpperCase()] = Number(g.Standard_TAT_Days) || 50; });
  const s = settings_();
  return { grades: grades, riskPct: Number(s.TAT_AT_RISK_PCT) || 0.8, grace: Number(s.NOTICE_GRACE_DAYS) || 30, today: ymd_(new Date()) };
}

function daysBetween_(a, b) {
  const pa = String(a).split('-'), pb = String(b).split('-');
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

function positionStatus_(l) {
  const a = String(l.Approval_Status || '').trim().toUpperCase();
  if (a === 'NO VACANCY') return 'No Vacancy';
  if (a === 'NOT NEEDED') return 'Not Needed';
  if (a === 'ON HOLD') return 'On Hold';
  if (a === 'APPROVED') {
    if (String(l.Offer_Sent).toUpperCase() !== 'YES') return 'Open';
    return l.Actual_DOJ ? 'Closed' : 'Offered';
  }
  return '';
}

/** TAT runs from the position assigned date; falls back to the MRF approved date, then the MRF received date. */
function tatStart_(l) {
  return ymd_(l.Assigned_On) || ymd_(l.Approved_On) || ymd_(l.Receipt_Date);
}

/** Returns the computed fields for one position line. */
function computeTat_(l, ctx) {
  const status = positionStatus_(l);
  const std = ctx.grades[String(l.Grade || '').trim().toUpperCase()] || 50;
  const notice = Number(l.Notice_Period_Days) || 0;
  const exemption = Math.max(notice - ctx.grace, 0);
  const fin = std + exemption;
  let end = ymd_(l.Actual_DOJ);
  if (!end && status === 'No Vacancy') end = ymd_(l.No_Vacancy_Date);
  if (!end && (status === 'Not Needed' || status === 'On Hold')) end = ymd_(l.Not_Needed_Date);
  const start = tatStart_(l);
  const days = start ? daysBetween_(start, end || ctx.today) : '';
  let result = '';
  if (days !== '') {
    if (status === 'Open' || status === 'Offered') {
      result = days > fin ? 'Overdue' : (days >= ctx.riskPct * fin ? 'At risk' : 'On track');
    } else {
      result = days > fin ? 'Missed' : 'Achieved';
    }
  }
  return { Position_Status: status, Standard_TAT: std, Exemption_Days: exemption, Final_TAT: fin,
    TAT_End_Date: end ? parseYmd_(end) : '', Days_Taken: days, TAT_Result: result };
}
