// Table definitions shared by the browser data layer (db.js) and the Node maintenance scripts.
const S = (extra = {}) => extra; // readability only
const TABLES = {
  users: { auto: true, defaults: S({ uid: '', email: '', username: '', name: '', role: 'contributor', active: 1, author_id: null, last_login: null }), stamp: ['created_at'] },
  authors: { auto: true, defaults: S({ name: '', slug: '', title: '', bio: '', image: '', is_sample: 0 }), stamp: ['created_at'] },
  categories: { auto: true, defaults: S({ name: '', slug: '', description: '', image: '', position: 0, active: 1 }) },
  tags: { auto: true, defaults: S({ name: '', slug: '' }) },
  media: { auto: true, defaults: S({ filename: '', url: '', resource_type: 'image', width: null, height: null, original_name: '', display_name: '', mime: '', size: 0, alt: '', caption: '', credit: '', uploaded_by: null }), stamp: ['created_at'] },
  articles: { auto: true, stamp: ['created_at', 'updated_at'], defaults: S({ title: '', subtitle: '', slug: '', excerpt: '', body: '', featured_media_id: null, image_caption: '', image_credit: '', author_id: null, category_id: null, status: 'draft',
    created_by: null, assigned_to: null, deadline: null, published_at: null, scheduled_at: null, seo_title: '', seo_description: '', is_featured: 0, is_announcement: 0, is_important: 0, is_sample: 0, views: 0 }) },
  article_tags: { defaults: { article_id: null, tag_id: null } },
  jobs: { auto: true, stamp: ['created_at', 'updated_at'], defaults: S({ title: '', slug: '', department: '', employment_type: 'Full-time', location: '', description: '', qualifications: '', responsibilities: '', how_to_apply: '', deadline: null, status: 'draft', is_sample: 0 }) },
  inquiries: { auto: true, stamp: ['created_at'], defaults: S({ name: '', email: '', category: 'Other', subject: '', message: '', consent: 1, status: 'new', is_read: 0, assigned_to: null, notes: '' }) },
  issues: { auto: true, stamp: ['created_at', 'updated_at'], defaults: S({ title: 'Untitled issue', masthead: 'Media News Network', date_text: '', edition: '1st Edition', volume: 'Vol. 001', price: '', justify: 1, hyphenate: 1, left_logo_media_id: null, right_logo_media_id: null, created_by: null }) },
  issue_pages: { auto: true, defaults: S({ issue_id: null, position: 0, layout: 'L2', front: 0, columns: 3, section: '', headline: '', deck: '', byline: '', dateline: '', caption: '', credit: '', photo_media_id: null, body: '' }) },
  staff: { auto: true, stamp: ['created_at'], defaults: S({ name: '', title: '', department: '', motto: '', bio: '', since: '', image: '', sort: 0, visible: 1, show_on_home: 1, slug: '', department_id: null, reports_to: null, author_id: null,
    social_linkedin: '', social_x: '', social_facebook: '', social_instagram: '', social_website: '', social_email: '' }) },
  departments: { auto: true, defaults: S({ name: '', slug: '', description: '', sort: 0 }) },
  subscribers: { auto: true, stamp: ['created_at'], defaults: S({ email: '', name: '', token: '', status: 'active', source: 'website' }) },
  newsletters: { auto: true, stamp: ['created_at', 'updated_at'], defaults: S({ subject: '', preheader: '', intro: '', outro: '', article_ids: '', status: 'draft', recipients: '', sent_ids: '', failed_ids: '', last_error: '', started_at: null, sent_at: null, created_by: null }) },
  home_pins: { defaults: { article_id: null, position: 0 } },
  settings: { defaults: { value: '' } },
  home_config: { defaults: { value: '' } },
};
module.exports = { TABLES };
