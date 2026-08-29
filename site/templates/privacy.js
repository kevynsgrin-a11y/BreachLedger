const { page } = require('./layout');

function render(ctx) {
  const { site, docs, renderMarkdown } = ctx;
  const body = renderMarkdown(docs.privacy || '# Privacy\n\nThis site collects no data about its readers.');
  const content = `<article class="doc">${body}</article>`;
  return page({
    site,
    assets: ctx.assets,
    route: '/privacy',
    title: 'Privacy',
    description:
      'BreachBook collects no data about its readers: no cookies, no analytics, no tracking, no third-party scripts, enforced by the Content-Security-Policy served with every page.',
    content,
  });
}

module.exports = { render };
