const { page } = require('./layout');

function render(ctx) {
  const { site } = ctx;
  const content = `
<h1>Page not found</h1>
<p>The page you requested does not exist in this record. It may have been renamed, or the breach it described
may still be in draft pending sourcing.</p>
<p>Start from <a href="/">the breach record</a> or review <a href="/sources/">sources and methodology</a>.</p>`;
  return page({
    site,
    assets: ctx.assets,
    route: '/404',
    title: 'Page not found',
    description: 'The requested page does not exist in this record.',
    content,
  });
}

module.exports = { render };
