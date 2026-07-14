/**
 * Invocable action exposing document generation to Flow.
 *
 * Queues generation by creating a Generated_Document__c record with
 * Status__c = 'QUEUED'; the Node.js poller worker picks it up, generates the
 * file, links it to the source record, and updates the status. This is the
 * same asynchronous path used by the docgenProgressButton LWC and
 * BatchDocgenEnqueue.
 *
 * The queued path is used instead of a synchronous callout because
 * record-triggered flows run with uncommitted DML, which blocks HTTP callouts.
 * This action therefore works from record-triggered, scheduled, and screen flows.
 *
 * Each request consumes SOQL queries to build the data envelope, so for
 * high-volume generation prefer BatchDocgenEnqueue.
 */
public with sharing class DocgenInvocable {

    public class GenerateRequest {
        @InvocableVariable(
            label='Record ID'
            description='ID of the source record (Account, Opportunity, Case, or another supported object)'
            required=true
        )
        public String recordId;

        @InvocableVariable(
            label='Template ID'
            description='ID of the Docgen Template record. Provide this or Template Name.'
        )
        public String templateId;

        @InvocableVariable(
            label='Template Name'
            description='Name of the Docgen Template record. Used when Template ID is blank.'
        )
        public String templateName;

        @InvocableVariable(
            label='Output Format'
            description='PDF, DOCX, or PPTX. Defaults to the template default output format (or PDF).'
        )
        public String outputFormat;

        @InvocableVariable(
            label='Read-Only Word'
            description='When true, DOCX output is generated as a protected read-only document. Ignored for PDF and PPTX.'
        )
        public Boolean readOnlyWord;
    }

    public class GenerateResult {
        @InvocableVariable(
            label='Success'
            description='True when the document was queued for generation'
        )
        public Boolean success;

        @InvocableVariable(
            label='Generated Document ID'
            description='ID of the Generated_Document__c record tracking this generation'
        )
        public String generatedDocumentId;

        @InvocableVariable(
            label='Status'
            description='Generation status (typically QUEUED; SUCCEEDED when an identical document already exists)'
        )
        public String status;

        @InvocableVariable(
            label='Error Message'
            description='Populated when Success is false'
        )
        public String errorMessage;
    }

    @InvocableMethod(
        label='Docgen: Generate Document'
        description='Queues document generation from a Docgen template for a record. The generated file is attached to the record when processing completes.'
        category='Docgen'
    )
    public static List<GenerateResult> generate(List<GenerateRequest> requests) {
        List<GenerateResult> results = new List<GenerateResult>();
        for (GenerateRequest request : requests) {
            results.add(processRequest(request));
        }
        return results;
    }

    /**
     * Process a single request, converting failures to an error result so one
     * bad request does not fault the other flow interviews in the batch.
     */
    private static GenerateResult processRequest(GenerateRequest request) {
        GenerateResult result = new GenerateResult();
        result.success = false;

        try {
            DocgenAsyncController.StartResult startResult = DocgenAsyncController.startGeneration(
                toId(request.templateId, 'Template ID'),
                request.templateName,
                toId(request.recordId, 'Record ID'),
                request.outputFormat,
                false,
                request.readOnlyWord == true
            );

            result.success = true;
            result.generatedDocumentId = startResult.generatedDocumentId;
            result.status = startResult.status;
        } catch (Exception e) {
            result.errorMessage = e.getMessage();
        }

        return result;
    }

    private static Id toId(String value, String label) {
        if (String.isBlank(value)) {
            return null;
        }
        try {
            return Id.valueOf(value.trim());
        } catch (Exception e) {
            throw new IllegalArgumentException('Invalid ' + label + ': ' + value);
        }
    }
}
