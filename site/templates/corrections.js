const { page } = require('./layout');

function render(ctx) {
  const { site, docs, renderMarkdown } = ctx;
  const body = renderMarkdown(docs.corrections || '# Corrections\n\nNo corrections have been issued.');
  const content = `<article class="doc">${body}</article>`;
  return page({
    site,
    route: '/corrections',
    title: 'Corrections',
    description: 'Corrections policy and the log of every correction issued, with the date and what changed.',
    content,
  });
}

module.exports = { render };
