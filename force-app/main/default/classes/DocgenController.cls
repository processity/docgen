/**
 * Controller for interactive document generation
 * Handles LWC requests to generate documents via Node API
 */
public with sharing class DocgenController {

    /**
     * Get Named Credential name from Custom Settings
     * Allows configuring different Named Credentials for different environments
     * (e.g., 'Docgen_Node_API_CI' for CI tests, 'Docgen_Node_API' for production)
     * Defaults to 'Docgen_Node_API' if not configured
     */
    @TestVisible
    private static String getNamedCredentialName() {
        Docgen_Settings__c settings = Docgen_Settings__c.getInstance();
        if (settings != null && String.isNotBlank(settings.Named_Credential_Name__c)) {
            return settings.Named_Credential_Name__c;
        }
        return 'Docgen_Node_API'; // Default to production Named Credential
    }

    /**
     * Generate a document interactively
     *
     * @param templateId ID of the Docgen_Template__c record
     * @param recordId ID of the source record (Account, Opportunity, Case, etc.)
     * @param outputFormat Output format (PDF or DOCX)
     * @return Download URL for the generated document
     * @throws AuraHandledException on validation or generation failures
     */
    @AuraEnabled
    public static String generate(Id templateId, Id recordId, String outputFormat) {
        Generated_Document__c doc;
        String correlationId = generateCorrelationId();

        try {
            // Step 1: Query template
            Docgen_Template__c template = queryTemplate(templateId);

            // Step 2: Build envelope with preformatted data
            DocgenEnvelopeService.Envelope envelope = buildEnvelope(
                template,
                recordId,
                outputFormat,
                correlationId
            );

            // Step 3: Check for existing successful document (idempotency short-circuit)
            Generated_Document__c existingDoc = checkExistingDocument(envelope.requestHash);
            if (existingDoc != null) {
                // Cache hit - return existing download URL without making callout
                return buildDownloadUrl(existingDoc.OutputFileId__c);
            }

            // Step 4: Make HTTP callout to Node API (must happen before DML)
            HTTPResponse response = callNodeApi(envelope);

            // Step 5: Create Generated_Document__c record AFTER successful callout
            // This avoids the DML-before-callout restriction in Salesforce
            doc = createGeneratedDocument(envelope, template.Id, recordId, correlationId);

            // Step 6: Handle response and update the record status
            return handleResponse(response, doc, correlationId);

        } catch (Exception e) {
            // Ensure record is marked as FAILED if it was created
            if (doc != null && doc.Id != null) {
                markAsFailed(doc.Id, e.getMessage(), correlationId);
            }

            // Re-throw as AuraHandledException for LWC
            AuraHandledException auraEx = new AuraHandledException(formatErrorMessage(e));
            auraEx.setMessage(formatErrorMessage(e));
            throw auraEx;
        }
    }

    /**
     * Generate a composite document interactively
     *
     * @param compositeDocId ID of the Composite_Document__c record
     * @param recordIds JSON string of record IDs (e.g., '{"accountId":"001xxx","contactId":"003xxx"}')
     * @param outputFormat Output format (PDF or DOCX)
     * @return Download URL for the generated document
     * @throws AuraHandledException on validation or generation failures
     */
    @AuraEnabled
    public static String generateComposite(Id compositeDocId, String recordIds, String outputFormat) {
        Generated_Document__c doc;
        String correlationId = generateCorrelationId();

        try {
            // Step 1: Parse recordIds JSON to Map
            Map<String, Id> recordIdsMap = parseRecordIds(recordIds);

            // Step 2: Build envelope via DocgenEnvelopeService.buildForComposite()
            DocgenEnvelopeService.Envelope envelope = buildCompositeEnvelope(
                compositeDocId,
                recordIdsMap,
                outputFormat,
                correlationId
            );

            // Step 3: Check for existing successful document (idempotency short-circuit)
            Generated_Document__c existingDoc = checkExistingDocument(envelope.requestHash);
            if (existingDoc != null) {
                // Cache hit - return existing download URL without making callout
                return buildDownloadUrl(existingDoc.OutputFileId__c);
            }

            // Step 4: Make HTTP callout to Node API (must happen before DML)
            HTTPResponse response = callNodeApi(envelope);

            // Step 5: Create Generated_Document__c record AFTER successful callout
            doc = createGeneratedDocumentForComposite(
                envelope,
                compositeDocId,
                recordIdsMap,
                correlationId
            );

            // Step 6: Handle response and update the record status
            return handleResponse(response, doc, correlationId);

        } catch (Exception e) {
            // Ensure record is marked as FAILED if it was created
            if (doc != null && doc.Id != null) {
                markAsFailed(doc.Id, e.getMessage(), correlationId);
            }

            // Re-throw as AuraHandledException for LWC
            AuraHandledException auraEx = new AuraHandledException(formatErrorMessage(e));
            auraEx.setMessage(formatErrorMessage(e));
            throw auraEx;
        }
    }

    /**
     * Get template ID by name
     * Used by LWC component to resolve template name to ID
     * Cacheable to avoid repeated queries for the same template
     */
    @AuraEnabled(cacheable=true)
    public static String getTemplateIdByName(String templateName) {
        try {
            if (String.isBlank(templateName)) {
                throw new AuraHandledException('Template name is required');
            }

            List<Docgen_Template__c> templates = [
                SELECT Id, Name
                FROM Docgen_Template__c
                WHERE Name = :templateName
                LIMIT 1
            ];

            if (templates.isEmpty()) {
                AuraHandledException ex = new AuraHandledException('Template not found: ' + templateName);
                ex.setMessage('Template not found: ' + templateName);
                throw ex;
            }

            return templates[0].Id;
        } catch (Exception e) {
            AuraHandledException auraEx = new AuraHandledException(e.getMessage());
            auraEx.setMessage(e.getMessage());
            throw auraEx;
        }
    }

    /**
     * Check for existing successful document within cache window (24 hours)
     * Implements idempotency by returning cached results for duplicate requests
     *
     * @param requestHash The idempotency hash
     * @return Existing document if found and succeeded, null otherwise
     */
    private static Generated_Document__c checkExistingDocument(String requestHash) {
        List<Generated_Document__c> existing = [
            SELECT Id, OutputFileId__c, Status__c, CreatedDate, CorrelationId__c
            FROM Generated_Document__c
            WHERE RequestHash__c = :requestHash
            AND Status__c = 'SUCCEEDED'
            AND CreatedDate = LAST_N_DAYS:1  // 24-hour cache window
            ORDER BY CreatedDate DESC
            LIMIT 1
        ];
        return existing.isEmpty() ? null : existing[0];
    }

    /**
     * Build Salesforce download URL for a ContentVersion
     *
     * @param contentVersionId The ID of the ContentVersion
     * @return Download URL in format: /sfc/servlet.shepherd/version/download/{contentVersionId}
     */
    private static String buildDownloadUrl(String contentVersionId) {
        // Salesforce download URL pattern per spec
        return '/sfc/servlet.shepherd/version/download/' + contentVersionId;
    }

    /**
     * Query template with validation
     */
    private static Docgen_Template__c queryTemplate(Id templateId) {
        List<Docgen_Template__c> templates = [
            SELECT Id, Name, TemplateContentVersionId__c, DataSource__c, SOQL__c,
                   ClassName__c, StoreMergedDocx__c, ReturnDocxToBrowser__c, PrimaryParent__c,
                   ReturnMultipleRecords__c
            FROM Docgen_Template__c
            WHERE Id = :templateId
            LIMIT 1
        ];

        if (templates.isEmpty()) {
            AuraHandledException ex = new AuraHandledException('Template not found: ' + templateId);
            ex.setMessage('Template not found: ' + templateId);
            throw ex;
        }

        return templates[0];
    }

    /**
     * Build JSON envelope for document generation
     */
    private static DocgenEnvelopeService.Envelope buildEnvelope(
        Docgen_Template__c template,
        Id recordId,
        String outputFormat,
        String correlationId
    ) {
        // Use en-GB locale and Europe/London timezone per spec
        String locale = 'en-GB';
        String timezone = 'Europe/London';

        DocgenEnvelopeService.Envelope envelope = DocgenEnvelopeService.build(
            recordId,
            template,
            outputFormat,
            locale,
            timezone
        );

        return envelope;
    }

    /**
     * Parse recordIds JSON string to Map<String, Id>
     * Handles LWC limitation where @AuraEnabled doesn't support Map<String, Id> parameters
     *
     * @param recordIds JSON string (e.g., '{"accountId":"001xxx","contactId":"003xxx"}')
     * @return Map of variable names to record IDs
     * @throws IllegalArgumentException if JSON is invalid or blank
     */
    @TestVisible
    private static Map<String, Id> parseRecordIds(String recordIds) {
        if (String.isBlank(recordIds)) {
            throw new IllegalArgumentException('recordIds parameter is required');
        }

        try {
            // Deserialize JSON to Map<String, Object> first
            Map<String, Object> rawMap = (Map<String, Object>) JSON.deserializeUntyped(recordIds);

            // Convert to Map<String, Id>
            Map<String, Id> recordIdsMap = new Map<String, Id>();
            for (String key : rawMap.keySet()) {
                String value = (String) rawMap.get(key);
                recordIdsMap.put(key, (Id) value);
            }

            return recordIdsMap;

        } catch (Exception e) {
            throw new IllegalArgumentException('Invalid recordIds JSON format: ' + e.getMessage());
        }
    }

    /**
     * Build JSON envelope for composite document generation
     *
     * @param compositeDocId Composite_Document__c ID
     * @param recordIds Map of variable names to record IDs
     * @param outputFormat Output format (PDF or DOCX)
     * @param correlationId Correlation ID for tracking
     * @return Envelope for Node API request
     */
    @TestVisible
    private static DocgenEnvelopeService.Envelope buildCompositeEnvelope(
        Id compositeDocId,
        Map<String, Id> recordIds,
        String outputFormat,
        String correlationId
    ) {
        // Use en-GB locale and Europe/London timezone per spec
        String locale = 'en-GB';
        String timezone = 'Europe/London';

        DocgenEnvelopeService.Envelope envelope = DocgenEnvelopeService.buildForComposite(
            compositeDocId,
            recordIds,
            outputFormat,
            locale,
            timezone
        );

        return envelope;
    }

    /**
     * Create Generated_Document__c record for composite document
     *
     * @param envelope Envelope with request data
     * @param compositeDocId Composite_Document__c ID
     * @param recordIds Map of record IDs used in generation
     * @param correlationId Correlation ID for tracking
     * @return Inserted Generated_Document__c record
     */
    @TestVisible
    private static Generated_Document__c createGeneratedDocumentForComposite(
        DocgenEnvelopeService.Envelope envelope,
        Id compositeDocId,
        Map<String, Id> recordIds,
        String correlationId
    ) {
        Generated_Document__c doc = new Generated_Document__c();
        doc.Composite_Document__c = compositeDocId;
        doc.RequestHash__c = envelope.requestHash;
        doc.RequestJSON__c = JSON.serialize(envelope);
        doc.Status__c = 'PROCESSING';
        doc.OutputFormat__c = envelope.outputFormat;
        doc.Attempts__c = 0;
        doc.RequestedBy__c = UserInfo.getUserId();
        doc.CorrelationId__c = correlationId;

        // Set parent lookup dynamically based on composite's PrimaryParent
        // Load composite to get PrimaryParent__c
        List<Composite_Document__c> composites = [
            SELECT PrimaryParent__c
            FROM Composite_Document__c
            WHERE Id = :compositeDocId
            LIMIT 1
        ];

        if (!composites.isEmpty()) {
            Composite_Document__c composite = composites[0];

            // Get the primary record ID from recordIds map
            Id primaryRecordId = determinePrimaryRecordId(composite.PrimaryParent__c, recordIds);

            if (primaryRecordId != null) {
                String objectApiName = primaryRecordId.getSObjectType().getDescribe().getName();

                // Validate object is supported and get configuration
                DocgenObjectConfigService.validateObjectSupported(objectApiName);
                Supported_Object__mdt config = DocgenObjectConfigService.getConfigForObject(objectApiName);

                // Dynamically set the parent lookup field using reflection
                doc.put(config.Lookup_Field_API_Name__c, primaryRecordId);
            }
        }

        insert doc;
        return doc;
    }

    /**
     * Determine primary record ID from recordIds map based on PrimaryParent configuration
     *
     * @param primaryParent Object type from Composite_Document__c.PrimaryParent__c (e.g., 'Account')
     * @param recordIds Map of variable names to record IDs
     * @return Primary record ID, or null if not found
     */
    @TestVisible
    private static Id determinePrimaryRecordId(String primaryParent, Map<String, Id> recordIds) {
        if (String.isBlank(primaryParent) || recordIds.isEmpty()) {
            return null;
        }

        // Try to find matching key in recordIds map
        // Convention: {objectName}Id in lowercase (e.g., accountId, contactId)
        String expectedKey = primaryParent.toLowerCase() + 'Id';

        for (String key : recordIds.keySet()) {
            if (key.toLowerCase() == expectedKey) {
                return recordIds.get(key);
            }
        }

        // Fallback: return first ID in map
        return recordIds.values()[0];
    }

    /**
     * Create Generated_Document__c record with PROCESSING status
     */
    private static Generated_Document__c createGeneratedDocument(
        DocgenEnvelopeService.Envelope envelope,
        Id templateId,
        Id recordId,
        String correlationId
    ) {
        Generated_Document__c doc = new Generated_Document__c();
        doc.Template__c = templateId;
        doc.RequestHash__c = envelope.requestHash;
        doc.RequestJSON__c = JSON.serialize(envelope);
        doc.Status__c = 'PROCESSING';
        doc.OutputFormat__c = envelope.outputFormat;
        doc.Attempts__c = 0;
        doc.RequestedBy__c = UserInfo.getUserId();
        doc.CorrelationId__c = correlationId;

        // Set parent lookup dynamically based on object configuration
        String objectApiName = recordId.getSObjectType().getDescribe().getName();

        // Validate object is supported and get configuration
        DocgenObjectConfigService.validateObjectSupported(objectApiName);
        Supported_Object__mdt config = DocgenObjectConfigService.getConfigForObject(objectApiName);

        // Dynamically set the parent lookup field using reflection
        doc.put(config.Lookup_Field_API_Name__c, recordId);

        insert doc;
        return doc;
    }

    /**
     * Make HTTP callout to Node API via Named Credential
     */
    private static HTTPResponse callNodeApi(DocgenEnvelopeService.Envelope envelope) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:' + getNamedCredentialName() + '/generate');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('Accept', 'application/json');
        req.setBody(JSON.serialize(envelope));
        req.setTimeout(120000); // 2 minutes timeout

        Http http = new Http();
        HTTPResponse res = http.send(req);

        return res;
    }

    /**
     * Handle HTTP response from Node API
     */
    private static String handleResponse(HTTPResponse response, Generated_Document__c doc, String correlationId) {
        Integer statusCode = response.getStatusCode();

        if (statusCode >= 200 && statusCode < 300) {
            // Success path
            Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(response.getBody());
            String contentVersionId = (String) body.get('contentVersionId');
            String responseCorrelationId = (String) body.get('correlationId');

            // Update record to SUCCEEDED
            // Note: CorrelationId__c was already set during insert and should not be modified
            update new Generated_Document__c(
                Id = doc.Id,
                Status__c = 'SUCCEEDED',
                OutputFileId__c = contentVersionId
            );

            // Build and return download URL
            return buildDownloadUrl(contentVersionId);

        } else {
            // Error path
            String errorMessage = 'HTTP ' + statusCode + ': ' + response.getStatus();

            // Try to parse error body
            try {
                Map<String, Object> errorBody = (Map<String, Object>) JSON.deserializeUntyped(response.getBody());
                if (errorBody.containsKey('error')) {
                    errorMessage += ' - ' + errorBody.get('error');
                }
            } catch (Exception e) {
                // If error body can't be parsed, use status line
                errorMessage += ' - ' + response.getBody();
            }

            // Update record to FAILED
            markAsFailed(doc.Id, errorMessage, correlationId);

            AuraHandledException ex = new AuraHandledException(errorMessage);
            ex.setMessage(errorMessage);
            throw ex;
        }
    }

    /**
     * Mark Generated_Document__c as FAILED
     */
    private static void markAsFailed(Id docId, String errorMessage, String correlationId) {
        // Truncate error message if needed (Error__c field limit)
        String truncatedError = errorMessage.length() > 131072
            ? errorMessage.substring(0, 131072)
            : errorMessage;

        update new Generated_Document__c(
            Id = docId,
            Status__c = 'FAILED',
            Error__c = truncatedError,
            CorrelationId__c = correlationId
        );
    }

    /**
     * Format exception message for LWC consumption
     */
    private static String formatErrorMessage(Exception e) {
        String message = e.getMessage();

        // If already an AuraHandledException, preserve message
        if (e instanceof AuraHandledException) {
            return message;
        }

        // For other exceptions, provide context
        if (e instanceof QueryException) {
            return 'Database query error: ' + message;
        } else if (e instanceof DmlException) {
            return 'Database operation failed: ' + message;
        } else if (e instanceof CalloutException) {
            return 'API callout failed: ' + message;
        } else {
            return 'Document generation failed: ' + message;
        }
    }

    /**
     * Generate correlation ID for request tracking
     */
    private static String generateCorrelationId() {
        // Generate 128-bit random value and convert to hex
        Blob b = Crypto.generateAesKey(128);
        String hex = EncodingUtil.convertToHex(b);

        // Format as UUID v4: xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx
        // Version 4 (random): set version bits (4) and variant bits (8/9/a/b)
        return hex.substring(0, 8) + '-' +
               hex.substring(8, 12) + '-' +
               '4' + hex.substring(12, 15) + '-' +
               '8' + hex.substring(15, 18) + '-' +
               hex.substring(18, 30);
    }
}