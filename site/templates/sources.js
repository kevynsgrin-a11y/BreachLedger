const { page } = require('./layout');

function render(ctx) {
  const { site, docs, renderMarkdown } = ctx;
  const body = renderMarkdown(docs.sources || '# Sources\n\nSource documentation pending.');
  const content = `<article class="doc">${body}</article>`;
  return page({
    site,
    route: '/sources',
    title: 'Sources and methodology',
    description: 'Every source this record is compiled from, its retrieval method, and when it was last verified.',
    content,
  });
}

module.exports = { render };
