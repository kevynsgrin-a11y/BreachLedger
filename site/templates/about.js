// About / publisher identity: /about
//
// Exists for accountability rather than marketing. This site publishes breach
// records, exposure of Social Security and medical data, and statutory
// deadlines — content Google's own guidelines class as YMYL — where a named,
// contactable publisher is part of what makes the record credible. The page
// also carries the Organization structured data that identifies the publisher
// to a crawler.

const { page } = require('./layout');
const { publisher } = require('./structured-data');

function render(ctx) {
  const { site, docs, renderMarkdown } = ctx;
  const body = renderMarkdown(docs.about || '# About\n\nPublisher information is not available.');
  const content = `<article class="doc">${body}</article>`;
  return page({
    site,
    assets: ctx.assets,
    structuredData: [publisher(site)],
    route: '/about',
    title: 'About',
    description:
      'BreachBook is published by Oak and Main Developers LLC, a California limited liability company: who compiles this record, what it is and is not, the editorial standards it is built to, and how to reach us.',
    content,
  });
}

module.exports = { render };
