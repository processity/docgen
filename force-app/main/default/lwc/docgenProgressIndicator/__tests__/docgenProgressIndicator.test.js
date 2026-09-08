import { createElement } from 'lwc';
import DocgenProgressIndicator from 'c/docgenProgressIndicator';

const mount = (status, progressValue = 60) => {
  const element = createElement('c-docgen-progress-indicator', { is: DocgenProgressIndicator });
  element.status = status;
  element.progressValue = progressValue;
  document.body.appendChild(element);
  return element;
};

afterEach(() => {
  document.body.innerHTML = '';
});

it.each([undefined, 'QUEUED', 'PROCESSING'])('shows actual percentage progress for %s', (status) => {
  const element = mount(status);
  const progress = element.shadowRoot.querySelector('[role="progressbar"]');
  expect(progress).not.toBeNull();
  expect(progress.getAttribute('aria-valuenow')).toBe('60');
  expect(element.shadowRoot.querySelector('.progress__fill').style.width).toBe('60%');
  expect(element.shadowRoot.querySelector('[role="status"]').getAttribute('aria-live')).toBe(
    'polite'
  );
});

it.each([
  ['SUCCEEDED', 'Your document is ready'],
  ['FAILED', 'Document generation failed'],
  ['CANCELED', 'Document generation canceled'],
])('stops animation and reports %s', async (status, title) => {
  const element = mount('PROCESSING');
  element.status = status;
  await Promise.resolve();
  const bar = element.shadowRoot.querySelector('[role="progressbar"]');
  if (status === 'SUCCEEDED') expect(bar.getAttribute('aria-valuenow')).toBe('100');
  else expect(bar).toBeNull();
  expect(element.shadowRoot.querySelector('.progress__sweep')).toBeNull();
  expect(element.shadowRoot.querySelector('.progress__scan')).toBeNull();
  expect(element.shadowRoot.querySelector('h3').textContent).toBe(title);
});

it('updates the fill and label when reported progress changes', async () => {
  const element = mount('PROCESSING', 20);
  element.progressValue = 60;
  await Promise.resolve();
  expect(element.shadowRoot.querySelector('.progress__percent').textContent).toBe('60%');
  expect(element.shadowRoot.querySelector('.progress__fill').style.width).toBe('60%');
});
