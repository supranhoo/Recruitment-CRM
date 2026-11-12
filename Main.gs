function doGet() {
  const t = HtmlService.createTemplateFromFile('Index');
  let boot = 'null';
  try { boot = JSON.stringify(apiBootstrap()).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); } catch (e) { boot = 'null'; }   // v165: no access, or any error: the page asks again and shows the message as before
  t.bootJson = boot;
  return t.evaluate()
    .setTitle('BFCL Recruitment CRM')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function include(file) {
  return HtmlService.createHtmlOutputFromFile(file).getContent();
}
