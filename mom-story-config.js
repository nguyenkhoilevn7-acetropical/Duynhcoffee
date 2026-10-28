'use strict';

// Customer-facing editorial content. Every field is plain text, never HTML.
const MOM_STORY_DEFAULTS = Object.freeze({
  eyebrow: 'CÂU CHUYỆN MOM’S',
  eyebrow_en: 'THE MOM’S STORY',
  headline: 'Trà ngon từ trái tim.',
  headline_en: 'Tea made with heart.',
  description: 'Một chút trà, một chút cà phê và những khoảnh khắc dễ chịu mỗi ngày. Mom’s Tea & Coffee phục vụ đặt món trực tuyến, để thức uống bạn yêu thích luôn gần hơn.',
  description_en: 'A little tea, a little coffee, and comforting moments every day. Mom’s Tea & Coffee serves online orders, bringing your favorite drinks closer to you.',
  slogan: 'Good drinks · Good mood',
  slogan_en: 'Good drinks · Good mood',
  cta: 'Xem thực đơn',
  cta_en: 'View menu'
});
const MOM_STORY_LIMITS = Object.freeze({
  eyebrow: 80, eyebrow_en: 80,
  headline: 130, headline_en: 130,
  description: 800, description_en: 800,
  slogan: 100, slogan_en: 100,
  cta: 50, cta_en: 50
});

function validateMomStory(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Object.assign(new Error('Nội dung giới thiệu không hợp lệ.'), {status:422});
  }
  const allowed = Object.keys(MOM_STORY_LIMITS);
  if (Object.keys(input).some(key => !allowed.includes(key))) {
    throw Object.assign(new Error('Nội dung giới thiệu chứa trường không hỗ trợ.'), {status:422});
  }
  const clean = {};
  for (const key of allowed) {
    const value = input[key];
    const limit = MOM_STORY_LIMITS[key];
    if (typeof value !== 'string' || !value.trim() || value.length > limit
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e]/.test(value)) {
      throw Object.assign(new Error('Vui lòng nhập nội dung hợp lệ cho ' + key + ' (tối đa ' + limit + ' ký tự).'), {status:422});
    }
    clean[key] = value.trim().replace(/\r\n?/g, '\n');
  }
  return clean;
}
module.exports = {MOM_STORY_DEFAULTS, MOM_STORY_LIMITS, validateMomStory};
