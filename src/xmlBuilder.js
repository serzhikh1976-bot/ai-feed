function escapeXml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapCdata(html) {
  const safe = String(html ?? '').replace(/]]>/g, ']]]]><![CDATA[>');
  return `<![CDATA[${safe}]]>`;
}

function formatDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

export function buildYmlFeed(job, opts = {}) {
  const shopName = opts.shopName || 'AI Feed Shop';
  const defaultCategoryId = opts.defaultCategoryId || '1';

  const includedItems = job.items.filter((it) => it && (it.status === 'success' || it.status === 'warning'));

  const categoryMap = new Map();
  for (const item of includedItems) {
    const id = item.categoryId || defaultCategoryId;
    const name = item.categoryPath && item.categoryPath.length > 0
      ? item.categoryPath[item.categoryPath.length - 1]
      : 'Товари, загальне';
    if (!categoryMap.has(id)) categoryMap.set(id, name);
  }
  if (categoryMap.size === 0) {
    categoryMap.set(defaultCategoryId, 'Товари, загальне');
  }

  const categoriesXml = [...categoryMap.entries()]
    .map(([id, name]) => `      <category id="${escapeXml(id)}">${escapeXml(name)}</category>`)
    .join('\n');

  const offersXml = includedItems
    .map((item) => {
      const categoryId = item.categoryId || defaultCategoryId;
      const paramsXml = (item.generatedParams || [])
        .map((p) => `        <param name="${escapeXml(p.name)}">${escapeXml(p.value)}</param>`)
        .join('\n');
      const generatedName = item.generatedName || item.name;
      const generatedDescription = item.generatedDescription || '';
      const seoTitle = item.seoTitle || generatedName;
      const seoDescription = item.seoDescription || generatedDescription.replace(/<[^>]*>/g, '').slice(0, 250);
      const searchQueries = item.searchQueries || '';

      return `      <offer id="${escapeXml(item.sku)}" available="${item.available ? 'true' : 'false'}" selling_type="r">
        <name>${escapeXml(generatedName)}</name>
        <name_ua>${escapeXml(generatedName)}</name_ua>
        <price>${escapeXml(item.price)}</price>
        <currencyId>UAH</currencyId>
        <categoryId>${escapeXml(categoryId)}</categoryId>
        <portal_category_id>${escapeXml(categoryId)}</portal_category_id>
        <vendor>${escapeXml(item.vendor || 'No Name')}</vendor>
        <vendorCode>${escapeXml(item.sku)}</vendorCode>
        <picture>${escapeXml(item.resolvedImage)}</picture>
        <description>${wrapCdata(generatedDescription)}</description>
        <description_ua>${wrapCdata(generatedDescription)}</description_ua>
${paramsXml}
        <html_title>${escapeXml(seoTitle)}</html_title>
        <html_description>${escapeXml(seoDescription)}</html_description>
        <search_queries>${escapeXml(searchQueries)}</search_queries>
      </offer>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE yml_catalog SYSTEM "shops.dtd">
<yml_catalog date="${formatDate(new Date())}">
  <shop>
    <name>${escapeXml(shopName)}</name>
    <currencies>
      <currency id="UAH" rate="1"/>
    </currencies>
    <categories>
${categoriesXml}
    </categories>
    <offers>
${offersXml}
    </offers>
  </shop>
</yml_catalog>
`;
}

export function countFeedItems(job) {
  return job.items.filter((it) => it && (it.status === 'success' || it.status === 'warning')).length;
}