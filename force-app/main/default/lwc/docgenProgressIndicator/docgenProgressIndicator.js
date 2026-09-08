import { LightningElement, api } from 'lwc';

const STATES = {
  QUEUED: ['Your document is queued', 'Waiting to start generation.'],
  PROCESSING: ['Creating your document', 'Applying your template and assembling the document.'],
  SUCCEEDED: ['Your document is ready', 'Generation complete.'],
  FAILED: ['Document generation failed', 'Review the error message before trying again.'],
  CANCELED: ['Document generation canceled', 'You can start again when you’re ready.'],
};

export default class DocgenProgressIndicator extends LightningElement {
  @api status;
  @api progressValue = 0;

  get percentage() {
    if (this.status === 'SUCCEEDED') return 100;
    return Math.round(Math.max(0, Math.min(100, Number(this.progressValue) || 0)));
  }

  get fillStyle() {
    return `width: ${this.percentage}%`;
  }

  get showProgress() {
    return this.isActive || this.status === 'SUCCEEDED';
  }

  get title() {
    return (STATES[this.status] || ['Preparing your document'])[0];
  }

  get description() {
    return (STATES[this.status] || ['', 'Getting your generation request ready.'])[1];
  }

  get isActive() {
    return !['SUCCEEDED', 'FAILED', 'CANCELED'].includes(this.status);
  }

  get stateClass() {
    return `progress progress_${this.isActive ? 'active' : this.status.toLowerCase()}`;
  }

  get terminalIcon() {
    if (this.status === 'SUCCEEDED') return 'utility:success';
    if (this.status === 'FAILED') return 'utility:error';
    return 'utility:close';
  }
}
