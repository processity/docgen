import { LightningElement, wire, track } from 'lwc';
import { CurrentPageReference, NavigationMixin } from 'lightning/navigation';
import getSupportedObjects from '@salesforce/apex/DocgenTestPageController.getSupportedObjects';
import getObjectTypeFromRecordId from '@salesforce/apex/DocgenTestPageController.getObjectTypeFromRecordId';
import getGeneratedDocuments from '@salesforce/apex/DocgenTestPageController.getGeneratedDocuments';

const COLUMNS = [
    {
        label: 'Document Name',
        fieldName: 'Name',
        type: 'text',
        sortable: true
    },
    {
        label: 'Status',
        fieldName: 'Status__c',
        type: 'text',
        sortable: true
    },
    {
        label: 'Output Format',
        fieldName: 'OutputFormat__c',
        type: 'text'
    },
    {
        label: 'Created Date',
        fieldName: 'CreatedDate',
        type: 'date',
        typeAttributes: {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        },
        sortable: true
    },
    {
        label: 'Template',
        fieldName: 'TemplateName',
        type: 'text'
    }
];

// Map object API names to SLDS icons
const OBJECT_ICONS = {
    'Account': 'standard:account',
    'Contact': 'standard:contact',
    'Lead': 'standard:lead',
    'Opportunity': 'standard:opportunity',
    'Case': 'standard:case'
};

export default class DocgenTestPage extends NavigationMixin(LightningElement) {
    @track recordId;
    @track templateId;
    @track generatedDocuments;
    @track selectedObjectApiName;
    @track selectedObjectConfig;
    @track supportedObjectsData = [];
    columns = COLUMNS;
    pageRef;

    // Get supported objects from custom metadata
    @wire(getSupportedObjects)
    wiredSupportedObjects({ error, data }) {
        if (data) {
            this.supportedObjectsData = data;
            // If no object selected but we have objects, and there's a recordId in URL, detect the object
            if (!this.selectedObjectApiName && this.recordId) {
                this.detectObjectTypeFromRecordId(this.recordId);
            }
        } else if (error) {
            console.error('Error loading supported objects:', error);
        }
    }

    // Get the current page reference to read URL parameters
    @wire(CurrentPageReference)
    getPageReference(pageRef) {
        this.pageRef = pageRef;
        if (pageRef && pageRef.state) {
            // Read c__recordId and c__templateId from URL parameters
            const recordIdParam = pageRef.state.c__recordId;
            const templateIdParam = pageRef.state.c__templateId;

            if (recordIdParam && recordIdParam !== this.recordId) {
                this.recordId = recordIdParam;
                // Detect object type from the recordId
                this.detectObjectTypeFromRecordId(recordIdParam);
            }

            if (templateIdParam && templateIdParam !== this.templateId) {
                this.templateId = templateIdParam;
            }
        }
    }

    // Detect object type from recordId using Apex
    detectObjectTypeFromRecordId(recordId) {
        getObjectTypeFromRecordId({ recordId })
            .then(objectType => {
                if (objectType) {
                    this.selectedObjectApiName = objectType;
                    this.updateSelectedObjectConfig();
                    this.loadGeneratedDocuments();
                }
            })
            .catch(error => {
                console.error('Error detecting object type:', error);
            });
    }

    // Compute object type options for the dropdown
    get objectTypeOptions() {
        return this.supportedObjectsData.map(obj => ({
            label: obj.Label || obj.DeveloperName || obj.Object_API_Name__c,
            value: obj.Object_API_Name__c
        }));
    }

    // Get the selected object config
    updateSelectedObjectConfig() {
        this.selectedObjectConfig = this.supportedObjectsData.find(
            obj => obj.Object_API_Name__c === this.selectedObjectApiName
        );
    }

    // Computed properties for dynamic labels and icons
    get selectedObjectLabel() {
        return this.selectedObjectConfig ?
            (this.selectedObjectConfig.Label || this.selectedObjectConfig.DeveloperName || this.selectedObjectApiName) :
            'Record';
    }

    get selectedObjectIcon() {
        return OBJECT_ICONS[this.selectedObjectApiName] || 'standard:default';
    }

    get recordSelectionTitle() {
        return `Select a ${this.selectedObjectLabel}`;
    }

    get recordSearchPlaceholder() {
        return `Search ${this.selectedObjectLabel}s...`;
    }

    get recordDetailsTitle() {
        return `${this.selectedObjectLabel} Details`;
    }

    get lookupFieldName() {
        return this.selectedObjectConfig ? this.selectedObjectConfig.Lookup_Field_API_Name__c : null;
    }

    // Handle object type selection
    handleObjectTypeChange(event) {
        const newObjectType = event.detail.value;

        // If object type changed, clear the recordId
        if (newObjectType !== this.selectedObjectApiName) {
            // Clear recordId and documents BEFORE changing object type to avoid inconsistent state
            this.recordId = null;
            this.generatedDocuments = null;
            // Now change the object type
            this.selectedObjectApiName = newObjectType;
            this.updateSelectedObjectConfig();
            this.updateUrlParams();
        }
    }

    // Handle record selection from lookup
    handleRecordSelection(event) {
        this.recordId = event.detail.recordId;

        if (this.recordId) {
            // Update URL to include the selected record ID
            this.updateUrlParams();
            this.loadGeneratedDocuments();
        } else {
            // Clear the recordId from URL
            this.updateUrlParams();
            this.generatedDocuments = null;
        }
    }

    // Handle template selection from lookup
    handleTemplateSelection(event) {
        this.templateId = event.detail.recordId;
        // Update URL to persist template selection
        this.updateUrlParams();
    }

    // Update the URL with recordId and templateId parameters
    updateUrlParams() {
        if (!this.pageRef) {
            return;
        }

        const newState = {
            ...this.pageRef.state
        };

        if (this.recordId) {
            newState.c__recordId = this.recordId;
        } else {
            delete newState.c__recordId;
        }

        if (this.templateId) {
            newState.c__templateId = this.templateId;
        } else {
            delete newState.c__templateId;
        }

        this[NavigationMixin.Navigate]({
            type: 'standard__navItemPage',
            attributes: {
                apiName: this.pageRef.attributes.apiName
            },
            state: newState
        }, true); // true = replace current history entry
    }

    // Load generated documents for the selected record
    loadGeneratedDocuments() {
        if (!this.recordId || !this.lookupFieldName) {
            return;
        }

        getGeneratedDocuments({
            recordId: this.recordId,
            lookupFieldName: this.lookupFieldName
        })
            .then(result => {
                // Transform the data to include template name from lookup
                this.generatedDocuments = result.map(doc => {
                    return {
                        ...doc,
                        TemplateName: doc.Template__r ? doc.Template__r.Name : 'N/A'
                    };
                });
            })
            .catch(error => {
                console.error('Error loading generated documents:', error);
                this.generatedDocuments = [];
            });
    }

    // Refresh documents when button generates a new one
    handleDocumentGenerated() {
        // Wait a moment for the record to be created, then refresh
        setTimeout(() => {
            this.loadGeneratedDocuments();
        }, 2000);
    }

    connectedCallback() {
        // Listen for custom event from docgenButton
        this.template.addEventListener('documentgenerated', this.handleDocumentGenerated.bind(this));
    }
}
