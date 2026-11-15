// Browser stand-in for multer's memory storage. The runtime has already read the form's File objects into
// req._files = { fieldName: [{ buffer, originalname, mimetype, size }] }; these middlewares expose them the way multer does.
function multer(opts = {}) {
  const maxSize = (opts.limits && opts.limits.fileSize) || Infinity;
  const make = (field, max) => (req, res, next) => {
    const list = ((req._files && req._files[field]) || []).filter(f => f && (f.size > 0 || f.originalname));
    for (const f of list) if (f.size > maxSize) return next(Object.assign(new Error('File too large'), { code: 'LIMIT_FILE_SIZE' }));
    if (max === 1) req.file = list[0]; else req.files = list.slice(0, max);
    next();
  };
  return { single: field => make(field, 1), array: (field, max) => make(field, max || 10), none: () => (req, res, next) => next() };
}
multer.memoryStorage = () => ({});
module.exports = multer;
