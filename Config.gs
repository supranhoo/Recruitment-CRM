/**
 * BFCL Recruitment CRM — configuration.
 * The database sheet ID is stored in Script Properties (DB_ID) by importDatabase().
 * If you created the sheet by hand instead, paste its ID below.
 */
const DB_SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty('DB_ID') || 'PASTE_DATABASE_SHEET_ID_HERE';
const TZ = 'Asia/Kolkata';

/** Table definitions: sheet name, id column, id prefix, date columns. */
const T = {
  MRF: {
    name: 'MRF', id: 'Line_ID', prefix: 'MRL-', width: 5,
    dates: ['Receipt_Date', 'No_Vacancy_Date', 'Not_Needed_Date', 'Offer_Date', 'EDOJ', 'Actual_DOJ', 'Backout_Date', 'TAT_End_Date',
      'BGV_Prev_Org_Date', 'BGV_Current_Org_Date', 'JD_Confirmed_Date', 'SQ_Confirmed_Date', 'Approved_On', 'Assigned_On', 'Replaced_On', 'TAT_Start_From', 'Reconciled_On'],
    editable: ['MRF_No', 'Receipt_Date', 'Position', 'Designation', 'Grade', 'Dept', 'Recruiter', 'No_Of_Positions', 'Approval_Status',
      'No_Vacancy_Date', 'Not_Needed_Date', 'Offer_Sent', 'Offer_Date', 'EDOJ', 'Actual_DOJ', 'Backout_Date',
      'Notice_Period_Days', 'Remarks', 'Candidate_ID', 'BGV_Required', 'BGV_Prev_Org_Date', 'BGV_Current_Org_Date', 'BGV_Remarks',
      'Tech_Panel', 'Final_Panel', 'JD_Text', 'Justification', 'Budget_CTC', 'Vacancy_Reason', 'Screening_Questions',
      'JD_Confirmed_Date', 'SQ_Confirmed_Date', 'Approved_On', 'Assigned_On']
  },
  FUNNEL: {
    name: 'Daily_Funnel', id: 'Entry_ID', prefix: 'DLY-', width: 6,
    dates: ['Entry_Date'],
    editable: ['Line_ID', 'Entry_Date', 'CV_Sourced', 'CV_Reviewed', 'HR_1st_Round', 'CV_Shared_Dept', 'Shortlisted_Dept',
      'Interviews_Done', 'Selected_Final', 'FB_From_Dept', 'Remarks', 'Exemption_Days']
  },
  CAND: {
    name: 'Candidates', id: 'Candidate_ID', prefix: 'CAN-', width: 5,
    dates: ['Tech_Interview_Date', 'HR_Interview_Date', 'DOJ', 'Psychometric_Date'],
    editable: ['CV_Box', 'Position', 'Name', 'Education', 'Relevant_Experience', 'Current_CTC', 'Current_Designation',
      'Offered_Designation', 'Dept', 'Business_Unit', 'Division', 'Mobile', 'Email', 'Tech_Interview_Date',
      'Tech_Interview_By', 'Tech_Result', 'HR_Interview_Date', 'HR_Interview_By', 'HR_Result', 'Interview_Remarks',
      'DOJ', 'Sourced_By', 'Source_Channel', 'Notes', 'Line_ID',
      'Psychometric_Status', 'Psychometric_Date', 'Psychometric_Score', 'Psychometric_Report',
      'Function_Area', 'Key_Skills', 'Total_Exp_Years', 'Current_Location', 'Expected_CTC', 'Notice_Days', 'Current_Company']
  },
  PANEL: {
    name: 'Panel_Unavailability', id: 'Entry_ID', prefix: 'PNL-', width: 4,
    dates: ['Date', 'To_Date'],
    editable: ['Panel_Member', 'Department', 'Designation', 'Interview_For', 'Date', 'To_Date', 'Kind', 'From_Time', 'To_Time',
      'Reason', 'Availability_Status', 'Remarks']
  }
};

T.OBS = {
  name: 'Observations', id: 'Obs_ID', prefix: 'OBS-', width: 4,
  dates: ['Obs_Date'],
  editable: ['Obs_Date', 'Line_ID', 'MRF_No', 'Recruiter', 'Type', 'Description', 'Status']
};
T.PM = {
  name: 'M_Panel_Members', id: 'Panel_ID', prefix: 'PM-', width: 3,
  dates: [],
  editable: ['Name', 'Aliases', 'Designation', 'Department', 'Email', 'Roles', 'Active', 'Note']
};
T.DAY = {
  name: 'Daily_Summary', id: 'Summary_ID', prefix: 'DS-', width: 5,
  dates: ['Summary_Date'],
  editable: ['Summary_Date', 'Recruiter', 'Overview', 'Tasks_JSON']
};
T.APP = {
  name: 'Applications', id: 'App_ID', prefix: 'APP-', width: 5,
  dates: ['Next_Followup', 'Offer_Accepted_On', 'Offer_Date', 'EDOJ', 'Actual_DOJ', 'Backout_Date'],
  editable: ['Stage', 'Status', 'Screening_JSON', 'Docs_JSON', 'Onboard_JSON', 'Offer_CTC', 'Offer_Accepted_On', 'Risk', 'Next_Followup', 'Status_Reason']
};
T.HIST = { name: 'Stage_History', id: 'Hist_ID', prefix: 'SH-', width: 6, dates: [], editable: [] };
T.POST = {
  name: 'Job_Posts', id: 'Post_ID', prefix: 'JP-', width: 4,
  dates: ['Posted_On', 'Closes_On'],
  editable: ['Line_ID', 'Post_Type', 'Channel', 'Posted_On', 'Closes_On', 'Reference', 'Status', 'Notes']
};
T.FU = { name: 'Followups', id: 'FU_ID', prefix: 'FU-', width: 5, dates: ['FU_Date', 'Next_Date'], editable: [] };
T.AUDIT = {
  name: 'Audit_Checks', id: 'Audit_ID', prefix: 'AUD-', width: 5,
  dates: [],
  editable: ['Result', 'Error_Field', 'Critical', 'Remarks']
};

const FUNNEL_METRICS = ['CV_Sourced', 'CV_Reviewed', 'HR_1st_Round', 'CV_Shared_Dept', 'Shortlisted_Dept', 'Interviews_Done', 'Selected_Final'];
const ROLES = { ADMIN: 'Admin', HEAD: 'Head of HR', TALEAD: 'TA Lead', RECRUITER: 'Recruiter' };
const ROLE_LIST = ['Admin', 'Head of HR', 'TA Lead', 'Recruiter'];
/**
 * What each role may do. 'lead' = team-wide powers (edit all positions, assign, move candidates back, team views,
 * admin data checks); 'withdraw_offer' = close a position with a live offer; 'system' = backups, archive, tools,
 * JD library import; 'jd_manage' = sign off and edit the JD Master;
 * 'tat_exempt' = approve, reject, grant and revoke TAT exemptions and verify notice extensions;
 * 'bgv_decide' = decide on a BGV discrepancy (Head of HR, Admin);
 * 'org_manage' = import the manpower report and edit the organogram structure and department mapping (Head of HR, Admin);
 * 'ctc_use' = use the CTC calculator; 'ctc_rules' = change the CTC rules (Admin only, never grantable); 'ctc_view_all' = see everyone's CTC
 * calculations; 'ctc_codes' = change the structure choices and allowances; 'ctc_issue' = make and issue letters; 'ctc_approve' = approve letters
 * when approval is on. The ctc_* permissions other than ctc_rules can be given to other roles in CTC calculator > Access (Role_Access sheet).
 */
const PERMS_ = {
  'Recruiter': [],
  'TA Lead': ['lead', 'tat_view', 'jd_manage'],
  'Head of HR': ['lead', 'withdraw_offer', 'tat_view', 'tat_edit', 'tat_exempt', 'users_view', 'jd_manage', 'bgv_decide', 'org_manage'],
  'Admin': ['lead', 'withdraw_offer', 'tat_view', 'tat_edit', 'tat_exempt', 'users_view', 'users_edit', 'system', 'jd_manage', 'bgv_decide', 'org_manage', 'ctc_use', 'ctc_rules', 'ctc_view_all', 'ctc_codes', 'ctc_issue', 'ctc_approve']
};
