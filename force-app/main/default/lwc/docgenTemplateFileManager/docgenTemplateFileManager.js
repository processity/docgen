import { LightningElement, api, wire, track } from 'lwc';
import { getRecord, updateRecord, deleteRecord } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getTemplateFiles from '@salesforce/apex/DocgenTemplateFileController.getTemplateFiles';
import getRecordMetadata from '@salesforce/apex/DocgenTemplateFileController.getRecordMetadata';
import updateTemplateContentVersionId from '@salesforce/apex/DocgenTemplateFileController.updateTemplateContentVersionId';

// Import schemas for both objects
import TEMPLATE_ID_FIELD from '@salesforce/schema/Docgen_Template__c.Id';
import TEMPLATE_CONTENT_VERSION_FIELD from '@salesforce/schema/Docgen_Template__c.TemplateContentVersionId__c';
import COMPOSITE_ID_FIELD from '@salesforce/schema/Composite_Document__c.Id';
import COMPOSITE_CONTENT_VERSION_FIELD from '@salesforce/schema/Composite_Document__c.TemplateContentVersionId__c';
import COMPOSITE_STRATEGY_FIELD from '@salesforce/schema/Composite_Document__c.Template_Strategy__c';

export default class DocgenTemplateFileManager extends LightningElement {
    @api recordId; // Can be either Docgen_Template__c or Composite_Document__c Id
    @track files = [];
    @track currentFileId;
    @track isUploading = false;
    @track recordMetadata = {};
    @track isLoading = true;

    // Component lifecycle - load metadata when initialized
    async connectedCallback() {
        await this.loadRecordMetadata();
    }

    // Load record metadata to determine object type and settings
    async loadRecordMetadata() {
        try {
            this.isLoading = true;
            this.recordMetadata = await getRecordMetadata({ recordId: this.recordId });
            this.currentFileId = this.recordMetadata.templateContentVersionId;

            // Only load files if we should show the file manager
            if (this.shouldShowFileManager) {
                await this.loadFiles();
            }
        } catch (error) {
            this.showToast('Error', 'Failed to load record metadata', 'error');
            console.error('Error loading metadata:', error);
        } finally {
            this.isLoading = false;
        }
    }

    // Determine if file manager should be shown based on object type and template strategy
    get shouldShowFileManager() {
        // For Docgen_Template__c, always show
        if (this.recordMetadata.objectType === 'Docgen_Template__c') {
            return true;
        }
        // For Composite_Document__c, only show if Template_Strategy__c = 'Own Template'
        if (this.recordMetadata.objectType === 'Composite_Document__c') {
            return this.recordMetadata.templateStrategy === 'Own Template';
        }
        return false;
    }

    // Get message for when Composite Document uses concatenated templates
    get concatenateMessage() {
        return this.recordMetadata.objectType === 'Composite_Document__c' &&
               this.recordMetadata.templateStrategy === 'Concatenate Templates';
    }

    // Get the appropriate field references based on object type
    get idField() {
        return this.recordMetadata.objectType === 'Composite_Document__c'
            ? COMPOSITE_ID_FIELD
            : TEMPLATE_ID_FIELD;
    }

    get contentVersionField() {
        return this.recordMetadata.objectType === 'Composite_Document__c'
            ? COMPOSITE_CONTENT_VERSION_FIELD
            : TEMPLATE_CONTENT_VERSION_FIELD;
    }

    // Load all files linked to this record
    async loadFiles() {
        try {
            const result = await getTemplateFiles({ recordId: this.recordId });
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

    // Update record with ContentVersionId
    async updateTemplateWithFile(contentDocumentId) {
        const maxRetries = 5;
        let retryCount = 0;

        while (retryCount < maxRetries) {
            try {
                // Query for all files linked to this record
                const result = await getTemplateFiles({ recordId: this.recordId });

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

                // Update the record using the new Apex method
                await updateTemplateContentVersionId({
                    recordId: this.recordId,
                    contentVersionId: uploadedVersion.Id
                });

                this.currentFileId = uploadedVersion.Id;
                this.recordMetadata.templateContentVersionId = uploadedVersion.Id;
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
            // Update using the new Apex method
            await updateTemplateContentVersionId({
                recordId: this.recordId,
                contentVersionId: versionId
            });

            this.currentFileId = versionId;
            this.recordMetadata.templateContentVersionId = versionId;
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

    get componentTitle() {
        if (this.recordMetadata.objectType === 'Composite_Document__c') {
            return 'Composite Document Template Files';
        }
        return 'Template Files';
    }
}