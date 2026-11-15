const T = '2026-11-01 08:00:00';
export const seed = () => ({
  _counters: { articles: 3, users: 2, categories: 2, authors: 1, tags: 1, media: 1 },
  users: {
    1: { uid: 'uid-admin', email: 'admin@mmg.test', username: 'admin', name: 'Ada Admin', role: 'super_admin', active: 1, author_id: 1, created_at: T },
    2: { uid: 'uid-writer', email: 'wendy@mmg.test', username: 'wendy', name: 'Wendy Writer', role: 'writer', active: 1, author_id: null, created_at: T },
  },
  roles: { 'uid-admin': { role: 'super_admin', active: 1, user_id: 1, key: '1' }, 'uid-writer': { role: 'writer', active: 1, user_id: 2, key: '2' } },
  categories: { 1: { name: 'News', slug: 'news', position: 1, active: 1 }, 2: { name: 'Features', slug: 'features', position: 2, active: 1 } },
  authors: { 1: { name: 'Ada Admin', slug: 'ada-admin', title: 'Editor-in-Chief', bio: 'Leads the newsroom.', created_at: T } },
  tags: { 1: { name: 'Launch', slug: 'launch' } },
  media: { 1: { filename: 'mmg/a', url: 'https://res.cloudinary.com/demo/image/upload/mmg/a.jpg', alt: 'A newsroom photo', width: 1600, height: 900, resource_type: 'image', created_at: T } },
  articles: {
    1: { title: 'Company launches new newsroom', slug: 'company-launches-new-newsroom', excerpt: 'A new era for MMG.', body: '<p>Hello <strong>world</strong>, this is the story body.</p><script>alert(1)</script>', status: 'published', category_id: 1, author_id: 1, featured_media_id: 1, published_at: T, created_at: T, updated_at: T, created_by: 1, is_featured: 1, views: 12 },
    2: { title: 'Secret draft', slug: 'secret-draft', body: '<p>Do not leak this.</p>', status: 'draft', category_id: 2, author_id: 1, created_by: 2, created_at: T, updated_at: T },
  },
  article_tags: { '1_1': { article_id: 1, tag_id: 1 } },
  settings: { contact_phone: { value: '+63 2 1234 5678' } },
});
