/**
 * Batch class for mass enqueueing of document generation jobs
 *
 * This batch class creates Generated_Document__c records with Status__c = 'QUEUED'
 * for mass document generation. The Node.js poller worker will pick up these
 * queued records and process them asynchronously.
 *
 * Supports both single-template and composite document generation.
 *
 * Usage - Single Template:
 *   List<Id> accountIds = new List<Id>{acc1.Id, acc2.Id, acc3.Id};
 *   BatchDocgenEnqueue batch = new BatchDocgenEnqueue(templateId, accountIds, 'PDF');
 *   Database.executeBatch(batch, 200);
 *
 * Usage - Composite Document:
 *   List<Id> accountIds = new List<Id>{acc1.Id, acc2.Id, acc3.Id};
 *   BatchDocgenEnqueue batch = new BatchDocgenEnqueue(
 *       compositeDocId,
 *       accountIds,
 *       'PDF',
 *       'accountId'
 *   );
 *   Database.executeBatch(batch, 50);
 *
 * Usage - Composite with Additional Static IDs:
 *   Map<String, Id> additionalIds = new Map<String, Id>{'termsId' => termsRecord.Id};
 *   BatchDocgenEnqueue batch = new BatchDocgenEnqueue(
 *       compositeDocId,
 *       accountIds,
 *       'PDF',
 *       'accountId',
 *       additionalIds
 *   );
 *   Database.executeBatch(batch, 50);
 *
 * @group Batch
 * @see Generated_Document__c
 * @see DocgenEnvelopeService
 * @see CompositeDocgenDataProvider
 */
public with sharing class BatchDocgenEnqueue implements Database.Batchable<Id>, Database.Stateful {

    // State variables - Single Template
    private Id templateId;
    private List<Id> recordIds;
    private String outputFormat;
    private Docgen_Template__c template;

    // State variables - Composite Document
    private Boolean isComposite = false;
    private Id compositeDocId;
    private Composite_Document__c composite;
    private String recordIdFieldName;
    private Map<String, Id> additionalRecordIds;

    // Statistics (tracked across batches via Database.Stateful)
    private Integer successCount = 0;
    private Integer failureCount = 0;
    private List<String> errors = new List<String>();

    /**
     * Constructor
     * @param templateId ID of the Docgen_Template__c record
     * @param recordIds List of record IDs to process (Account, Opportunity, Case, etc.)
     * @param outputFormat Output format: 'PDF' or 'DOCX'
     * @throws QueryException if template not found
     */
    public BatchDocgenEnqueue(Id templateId, List<Id> recordIds, String outputFormat) {
        this.templateId = templateId;
        this.recordIds = recordIds;
        this.outputFormat = outputFormat;

        // Validate and load template
        if (templateId == null) {
            throw new IllegalArgumentException('templateId cannot be null');
        }

        if (recordIds == null || recordIds.isEmpty()) {
            throw new IllegalArgumentException('recordIds cannot be null or empty');
        }

        if (outputFormat != 'PDF' && outputFormat != 'DOCX') {
            throw new IllegalArgumentException('outputFormat must be PDF or DOCX');
        }

        // Load template (will throw QueryException if not found)
        List<Docgen_Template__c> templates = [
            SELECT Id, Name, TemplateContentVersionId__c, DataSource__c, SOQL__c,
                   ClassName__c, StoreMergedDocx__c, ReturnDocxToBrowser__c, PrimaryParent__c,
                   ReturnMultipleRecords__c
            FROM Docgen_Template__c
            WHERE Id = :templateId
            LIMIT 1
        ];

        if (templates.isEmpty()) {
            throw new QueryException('Template not found: ' + templateId);
        }

        this.template = templates[0];
    }

    /**
     * Constructor for Composite Documents
     * @param compositeDocId ID of the Composite_Document__c record
     * @param recordIds List of record IDs to process (Account, Opportunity, Case, etc.)
     * @param outputFormat Output format: 'PDF' or 'DOCX'
     * @param recordIdFieldName Variable name for batch record IDs (e.g., 'accountId', 'opportunityId')
     * @throws QueryException if composite not found
     */
    public BatchDocgenEnqueue(
        Id compositeDocId,
        List<Id> recordIds,
        String outputFormat,
        String recordIdFieldName
    ) {
        this(compositeDocId, recordIds, outputFormat, recordIdFieldName, null);
    }

    /**
     * Constructor for Composite Documents with Additional Static RecordIds
     * @param compositeDocId ID of the Composite_Document__c record
     * @param recordIds List of record IDs to process (Account, Opportunity, Case, etc.)
     * @param outputFormat Output format: 'PDF' or 'DOCX'
     * @param recordIdFieldName Variable name for batch record IDs (e.g., 'accountId', 'opportunityId')
     * @param additionalRecordIds Static IDs shared across all batch records (e.g., {'termsId': termRecord.Id})
     * @throws QueryException if composite not found
     */
    public BatchDocgenEnqueue(
        Id compositeDocId,
        List<Id> recordIds,
        String outputFormat,
        String recordIdFieldName,
        Map<String, Id> additionalRecordIds
    ) {
        this.isComposite = true;
        this.compositeDocId = compositeDocId;
        this.recordIds = recordIds;
        this.outputFormat = outputFormat;
        this.recordIdFieldName = recordIdFieldName;
        this.additionalRecordIds = additionalRecordIds;

        // Validate inputs
        if (compositeDocId == null) {
            throw new IllegalArgumentException('compositeDocId cannot be null');
        }

        if (recordIds == null || recordIds.isEmpty()) {
            throw new IllegalArgumentException('recordIds cannot be null or empty');
        }

        if (outputFormat != 'PDF' && outputFormat != 'DOCX') {
            throw new IllegalArgumentException('outputFormat must be PDF or DOCX');
        }

        if (String.isBlank(recordIdFieldName)) {
            throw new IllegalArgumentException('recordIdFieldName cannot be blank');
        }

        // Load composite configuration
        List<Composite_Document__c> composites = [
            SELECT Id, Name, Template_Strategy__c, TemplateContentVersionId__c,
                   StoreMergedDocx__c, ReturnDocxToBrowser__c, PrimaryParent__c, IsActive__c
            FROM Composite_Document__c
            WHERE Id = :compositeDocId
            LIMIT 1
        ];

        if (composites.isEmpty()) {
            throw new QueryException('Composite Document not found: ' + compositeDocId);
        }

        this.composite = composites[0];

        if (!this.composite.IsActive__c) {
            throw new IllegalArgumentException('Composite Document is not active: ' + compositeDocId);
        }
    }

    /**
     * Start method - returns iterable of record IDs
     * @param bc BatchableContext
     * @return Iterable of record IDs to process
     */
    public Iterable<Id> start(Database.BatchableContext bc) {
        System.debug('BatchDocgenEnqueue starting: ' + recordIds.size() + ' records to process');
        return recordIds;
    }

    /**
     * Execute method - processes a batch of record IDs
     * Creates Generated_Document__c records with Status=QUEUED for each record
     * Supports both single-template and composite document modes
     * @param bc BatchableContext
     * @param scope List of record IDs in this batch chunk
     */
    public void execute(Database.BatchableContext bc, List<Id> scope) {
        String mode = isComposite ? 'composite' : 'template';
        System.debug('BatchDocgenEnqueue executing batch of ' + scope.size() + ' records (' + mode + ' mode)');

        List<Generated_Document__c> documentsToInsert = new List<Generated_Document__c>();

        for (Id recordId : scope) {
            try {
                DocgenEnvelopeService.Envelope envelope;

                if (isComposite) {
                    // COMPOSITE MODE: Build recordIds map and call buildForComposite
                    Map<String, Id> recordIdsMap = buildCompositeRecordIdsMap(recordId);

                    envelope = DocgenEnvelopeService.buildForComposite(
                        this.compositeDocId,
                        recordIdsMap,
                        this.outputFormat,
                        'en-GB', // Default locale (could be parameterized in future)
                        'Europe/London' // Default timezone (could be parameterized in future)
                    );
                } else {
                    // SINGLE TEMPLATE MODE: Use existing build method
                    envelope = DocgenEnvelopeService.build(
                        recordId,
                        this.template,
                        this.outputFormat,
                        'en-GB', // Default locale (could be parameterized in future)
                        'Europe/London' // Default timezone (could be parameterized in future)
                    );
                }

                // Serialize envelope to JSON and truncate if needed
                String requestJSON = DocgenEnvelopeService.toJSON(envelope);
                requestJSON = truncateIfNeeded(requestJSON);

                // Generate correlation ID (for Generated_Document__c tracking only)
                String correlationId = generateCorrelationId();

                // Create Generated_Document__c record
                Generated_Document__c doc = new Generated_Document__c(
                    Status__c = 'QUEUED',
                    RequestJSON__c = requestJSON,
                    RequestHash__c = envelope.requestHash,
                    CorrelationId__c = correlationId,
                    OutputFormat__c = this.outputFormat,
                    Priority__c = 0, // Default priority
                    Attempts__c = 0  // Start with 0 attempts
                );

                // Set Template__c or Composite_Document__c based on mode
                if (isComposite) {
                    doc.Composite_Document__c = this.compositeDocId;
                } else {
                    doc.Template__c = this.templateId;
                }

                // Set parent lookups based on record type
                setParentLookup(doc, recordId, envelope.parents);

                documentsToInsert.add(doc);
                successCount++;

            } catch (Exception e) {
                // Log error but continue processing other records
                failureCount++;
                String context = isComposite ? 'composite ' + compositeDocId : 'template ' + templateId;
                String errorMsg = 'Error processing ' + context + ' for record ' + recordId + ': ' + e.getMessage();
                errors.add(errorMsg);
                System.debug(LoggingLevel.ERROR, errorMsg);
            }
        }

        // Insert Generated_Document__c records
        if (!documentsToInsert.isEmpty()) {
            try {
                Database.SaveResult[] results = Database.insert(documentsToInsert, false);

                // Check for partial failures
                for (Integer i = 0; i < results.size(); i++) {
                    if (!results[i].isSuccess()) {
                        successCount--; // Decrement success count
                        failureCount++; // Increment failure count

                        Database.Error error = results[i].getErrors()[0];
                        String errorMsg = 'DML Error for record ' + scope[i] + ': ' +
                                        error.getStatusCode() + ' - ' + error.getMessage();
                        errors.add(errorMsg);
                        System.debug(LoggingLevel.ERROR, errorMsg);
                    }
                }
            } catch (DmlException e) {
                // Handle batch insert failure
                failureCount += documentsToInsert.size();
                String errorMsg = 'Batch DML Exception: ' + e.getMessage();
                errors.add(errorMsg);
                System.debug(LoggingLevel.ERROR, errorMsg);
            }
        }
    }

    /**
     * Finish method - logs completion statistics
     * Supports both template and composite modes
     * @param bc BatchableContext
     */
    public void finish(Database.BatchableContext bc) {
        System.debug('========================================');
        System.debug('BatchDocgenEnqueue completed');

        if (isComposite) {
            System.debug('Mode: Composite Document');
            System.debug('Composite: ' + composite.Name + ' (' + compositeDocId + ')');
            System.debug('Strategy: ' + composite.Template_Strategy__c);
        } else {
            System.debug('Mode: Single Template');
            System.debug('Template: ' + template.Name + ' (' + templateId + ')');
        }

        System.debug('Output Format: ' + outputFormat);
        System.debug('Records Processed: ' + (successCount + failureCount));
        System.debug('Successes: ' + successCount);
        System.debug('Failures: ' + failureCount);

        if (!errors.isEmpty()) {
            System.debug('Errors encountered (' + errors.size() + '):');
            for (String error : errors) {
                System.debug('  - ' + error);
            }
        }

        System.debug('========================================');

        // Query actual count of queued documents for verification
        Integer queuedCount;
        if (isComposite) {
            queuedCount = [
                SELECT COUNT()
                FROM Generated_Document__c
                WHERE Composite_Document__c = :compositeDocId
                AND Status__c = 'QUEUED'
            ];
            System.debug('Total QUEUED documents for this composite: ' + queuedCount);
        } else {
            queuedCount = [
                SELECT COUNT()
                FROM Generated_Document__c
                WHERE Template__c = :templateId
                AND Status__c = 'QUEUED'
            ];
            System.debug('Total QUEUED documents for this template: ' + queuedCount);
        }
    }

    /**
     * Set parent lookup field based on record type using dynamic reflection
     * @param doc Generated_Document__c record to update
     * @param recordId ID of the parent record
     * @param parents Map of parent IDs from envelope
     */
    private void setParentLookup(Generated_Document__c doc, Id recordId, Map<String, Id> parents) {
        // Get object type from recordId
        String objectApiName = recordId.getSObjectType().getDescribe().getName();

        // Validate object is supported and get configuration
        DocgenObjectConfigService.validateObjectSupported(objectApiName);
        Supported_Object__mdt config = DocgenObjectConfigService.getConfigForObject(objectApiName);

        // Dynamically set the parent lookup field using reflection
        doc.put(config.Lookup_Field_API_Name__c, recordId);

        // Also set additional parent lookups from envelope if available
        // This handles cases where a record has multiple parent relationships
        // (e.g., Opportunity has both OpportunityId and AccountId)
        if (parents != null && !parents.isEmpty()) {
            for (String parentKey : parents.keySet()) {
                Id parentId = parents.get(parentKey);
                if (parentId != null) {
                    // Extract object name from the key (e.g., 'AccountId' -> 'Account')
                    String parentObjectName = parentKey.replace('Id', '');

                    // Check if this parent object is configured
                    if (DocgenObjectConfigService.isObjectSupported(parentObjectName)) {
                        Supported_Object__mdt parentConfig = DocgenObjectConfigService.getConfigForObject(parentObjectName);
                        // Set the additional parent lookup dynamically
                        doc.put(parentConfig.Lookup_Field_API_Name__c, parentId);
                    }
                }
            }
        }
    }

    /**
     * Build recordIds map for composite document generation
     * Merges additionalRecordIds with current batch recordId
     * @param recordId Current batch record ID
     * @return Map<String, Id> with all recordIds for this composite generation
     */
    private Map<String, Id> buildCompositeRecordIdsMap(Id recordId) {
        Map<String, Id> recordIdsMap = new Map<String, Id>();

        // Start with additional static IDs (if provided)
        if (additionalRecordIds != null && !additionalRecordIds.isEmpty()) {
            recordIdsMap.putAll(additionalRecordIds);
        }

        // Add the current batch recordId with its field name
        recordIdsMap.put(recordIdFieldName, recordId);

        return recordIdsMap;
    }

    /**
     * Truncate JSON string if it exceeds RequestJSON__c field limit (131KB)
     * @param json JSON string to truncate
     * @return Truncated JSON with [TRUNCATED] marker if necessary
     */
    private String truncateIfNeeded(String json) {
        final Integer MAX_SIZE = 131072; // 131KB in bytes (RequestJSON__c field limit)

        if (String.isBlank(json)) {
            return json;
        }

        if (json.length() > MAX_SIZE) {
            String truncatedMarker = '[TRUNCATED]';
            Integer truncateAt = MAX_SIZE - truncatedMarker.length();
            return json.substring(0, truncateAt) + truncatedMarker;
        }

        return json;
    }

    /**
     * Generate a UUID-style correlation ID
     * @return String correlation ID (UUID v4 format)
     */
    private String generateCorrelationId() {
        // Generate UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
        Blob b = Crypto.generateAESKey(128);
        String hex = EncodingUtil.convertToHex(b);

        // Format as UUID v4
        String guid = hex.substring(0, 8) + '-' +
                     hex.substring(8, 12) + '-' +
                     '4' + hex.substring(13, 16) + '-' +
                     hex.substring(16, 20) + '-' +
                     hex.substring(20, 32);

        return guid.toLowerCase();
    }
}
