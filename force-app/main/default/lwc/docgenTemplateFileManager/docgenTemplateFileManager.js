import { LightningElement, api, wire, track } from 'lwc';
import { getRecord, updateRecord, deleteRecord } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getTemplateFiles from '@salesforce/apex/DocgenTemplateFileController.getTemplateFiles';
import TEMPLATE_ID_FIELD from '@salesforce/schema/Docgen_Template__c.Id';
import CONTENT_VERSION_ID_FIELD from '@salesforce/schema/Docgen_Template__c.TemplateContentVersionId__c';

export default class DocgenTemplateFileManager extends LightningElement {
    @api recordId; // Docgen_Template__c Id
    @track files = [];
    @track currentFileId;
    @track isUploading = false;

    // Load files when component initializes or recordId changes
    @wire(getRecord, { recordId: '$recordId', fields: [CONTENT_VERSION_ID_FIELD] })
    wiredRecord({ error, data }) {
        if (data) {
            this.currentFileId = data.fields.TemplateContentVersionId__c.value;
            this.loadFiles();
        }
    }

    // Load all files linked to this template
    async loadFiles() {
        try {
            const result = await getTemplateFiles({ templateId: this.recordId });
            this.files = result.map(file => ({
                ...file,
                isCurrent: file.Id === this.currentFileId,
                downloadUrl: `/sfc/servlet.shepherd/version/download/${file.Id}`,
                viewUrl: `/lightning/r/ContentDocument/${file.ContentDocumentId}/view`
            }));
        } catch (error) {
            this.showToast('Error', 'Failed to load template files', 'error');
            console.error('Error loading files:', error);
        }
    }

    // Handle file upload completion
    handleUploadFinished(event) {
        const uploadedFiles = event.detail.files;
        if (uploadedFiles && uploadedFiles.length > 0) {
            const file = uploadedFiles[0];

            // Check file extension
            if (!file.name.toLowerCase().endsWith('.docx')) {
                this.showToast(
                    'Invalid File Type',
                    'Only DOCX files are supported for templates',
                    'error'
                );
                return;
            }

            this.isUploading = true;

            // The upload event gives us the ContentDocumentId
            // We need to get the ContentVersionId for this document
            // Wait a moment for Salesforce to process the link
            setTimeout(() => {
                this.updateTemplateWithFile(file.documentId);
            }, 3000);
        }
    }

    // Update template record with ContentVersionId
    async updateTemplateWithFile(contentDocumentId) {
        const maxRetries = 5;
        let retryCount = 0;

        while (retryCount < maxRetries) {
            try {
                // Query for all files linked to this template
                const result = await getTemplateFiles({ templateId: this.recordId });

                console.log('Attempt ' + (retryCount + 1) + ': Found ' + result.length + ' files');
                console.log('Looking for ContentDocumentId: ' + contentDocumentId);

                // Find the version with matching ContentDocumentId and IsLatest = true
                const uploadedVersion = result.find(
                    v => v.ContentDocumentId === contentDocumentId && v.IsLatest === true
                );

                console.log('Found version:', uploadedVersion);

                if (!uploadedVersion) {
                    // File might not be linked yet, retry
                    if (retryCount < maxRetries - 1) {
                        retryCount++;
                        console.log('File not found, retrying in 2 seconds...');
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        continue;
                    }
                    throw new Error('Could not find uploaded file after ' + maxRetries + ' attempts. Please refresh the page and set the template file manually using "Use This Version" button.');
                }

                // Update the template record
                const fields = {};
                fields[TEMPLATE_ID_FIELD.fieldApiName] = this.recordId;
                fields[CONTENT_VERSION_ID_FIELD.fieldApiName] = uploadedVersion.Id;

                const recordInput = { fields };
                await updateRecord(recordInput);

                this.currentFileId = uploadedVersion.Id;
                this.showToast(
                    'Success',
                    'Template file updated successfully',
                    'success'
                );

                // Refresh the files list
                await this.loadFiles();
                break;

            } catch (error) {
                if (retryCount === maxRetries - 1) {
                    this.showToast(
                        'Error',
                        'Failed to update template: ' + (error.body?.message || error.message),
                        'error'
                    );
                }
                break;
            }
        }

        this.isUploading = false;
    }

    // Handle "Use This Version" button click
    async handleUseVersion(event) {
        const versionId = event.target.dataset.versionId;

        try {
            const fields = {};
            fields[TEMPLATE_ID_FIELD.fieldApiName] = this.recordId;
            fields[CONTENT_VERSION_ID_FIELD.fieldApiName] = versionId;

            const recordInput = { fields };
            await updateRecord(recordInput);

            this.currentFileId = versionId;
            this.showToast(
                'Success',
                'Template version updated successfully',
                'success'
            );

            // Refresh to update "Current" badges
            await this.loadFiles();

        } catch (error) {
            this.showToast(
                'Error',
                'Failed to update template version: ' + (error.body?.message || error.message),
                'error'
            );
        }
    }

    // Handle file deletion
    async handleDeleteFile(event) {
        const documentId = event.target.dataset.documentId;
        const fileToDelete = this.files.find(f => f.ContentDocumentId === documentId);

        if (!fileToDelete) {
            return;
        }

        // Prevent deleting the current template file
        if (fileToDelete.isCurrent) {
            this.showToast(
                'Cannot Delete',
                'Cannot delete the current active template. Please set a different version as current first.',
                'error'
            );
            return;
        }

        // Confirm deletion
        const confirmDelete = confirm(
            `Are you sure you want to delete "${fileToDelete.Title}"? This cannot be undone.`
        );

        if (!confirmDelete) {
            return;
        }

        try {
            // Delete the ContentDocument (this deletes all versions)
            await this.deleteContentDocument(documentId);

            this.showToast(
                'Success',
                'File deleted successfully',
                'success'
            );

            // Refresh the file list
            await this.loadFiles();

        } catch (error) {
            this.showToast(
                'Error',
                'Failed to delete file: ' + (error.body?.message || error.message),
                'error'
            );
        }
    }

    // Delete ContentDocument using LDS
    async deleteContentDocument(documentId) {
        await deleteRecord(documentId);
    }

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    get acceptedFormats() {
        return ['.docx'];
    }

    get hasFiles() {
        return this.files && this.files.length > 0;
    }
}
