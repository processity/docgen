// Public exports for template module

export { TemplateCache, templateCache } from './cache';
export { TemplateService } from './service';
export { mergeTemplate, validateMergeData, extractImageUrls } from './merge';
export { applyWatermarkToDocx } from './docx-postprocess';
export { prepareRichTextData, htmlToWordprocessingMl } from './rich-text';
export { concatenateDocx } from './concatenate';
