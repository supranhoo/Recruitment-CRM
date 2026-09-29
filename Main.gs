function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('BFCL Recruitment CRM')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function include(file) {
  return HtmlService.createHtmlOutputFromFile(file).getContent();
}
