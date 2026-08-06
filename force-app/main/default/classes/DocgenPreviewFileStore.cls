/**
 * Reads and deletes backend-owned preview files in system context.
 *
 * The public controller validates the generated document, its requester, and
 * its pending state before calling this internal storage boundary.
 */
public without sharing class DocgenPreviewFileStore {
    public class PreviewPageFile {
        public Blob data { get; private set; }
        public Integer previewPageCount { get; private set; }

        private PreviewPageFile(Blob data, Integer previewPageCount) {
            this.data = data;
            this.previewPageCount = previewPageCount;
        }
    }

    public static PreviewPageFile loadPreviewPage(
        String contentVersionIdsJson,
        Integer pageNumber,
        Integer maxPages,
        Integer maxBytes
    ) {
        List<Id> contentVersionIds = parsePreviewContentVersionIds(contentVersionIdsJson);
        Integer previewPageCount = Math.min(contentVersionIds.size(), maxPages);
        if (pageNumber > previewPageCount) {
            throw new IllegalArgumentException(
                'Only the first ' + previewPageCount + ' PDF preview pages are available.'
            );
        }

        Id pageContentVersionId = contentVersionIds[pageNumber - 1];
        List<ContentVersion> versions = [
            SELECT Id, FileExtension, ContentSize, VersionData
            FROM ContentVersion
            WHERE Id = :pageContentVersionId
            LIMIT 1
        ];
        if (versions.isEmpty()) {
            throw new IllegalArgumentException('PDF preview page is unavailable. Generate the document again.');
        }

        ContentVersion version = versions[0];
        String extension = String.isBlank(version.FileExtension)
            ? ''
            : version.FileExtension.toLowerCase();
        if (extension != 'jpg' && extension != 'jpeg') {
            throw new IllegalArgumentException('PDF preview page has an unsupported file type.');
        }
        if (version.ContentSize == null || version.ContentSize < 1 || version.ContentSize > maxBytes) {
            throw new IllegalArgumentException('PDF preview page is too large or empty.');
        }

        return new PreviewPageFile(version.VersionData, previewPageCount);
    }

    public static Set<Id> parsePreviewContentVersionIdSet(String contentVersionIdsJson) {
        return new Set<Id>(parsePreviewContentVersionIds(contentVersionIdsJson));
    }

    public static void deleteContentVersions(Set<Id> contentVersionIds) {
        if (contentVersionIds == null || contentVersionIds.isEmpty()) {
            return;
        }

        List<ContentDocument> contentDocuments = [
            SELECT Id
            FROM ContentDocument
            WHERE Id IN (
                SELECT ContentDocumentId
                FROM ContentVersion
                WHERE Id IN :contentVersionIds
            )
        ];
        if (contentDocuments.isEmpty()) {
            return;
        }

        List<Database.DeleteResult> results = Database.delete(contentDocuments, false);
        for (Database.DeleteResult result : results) {
            if (!result.isSuccess()) {
                throw new IllegalArgumentException('Unable to remove temporary document files. Try again.');
            }
        }
    }

    private static List<Id> parsePreviewContentVersionIds(String contentVersionIdsJson) {
        if (String.isBlank(contentVersionIdsJson)) {
            throw new IllegalArgumentException('PDF preview pages are unavailable. Generate the document again.');
        }

        try {
            List<Object> rawIds = (List<Object>) JSON.deserializeUntyped(contentVersionIdsJson);
            if (rawIds == null || rawIds.isEmpty()) {
                throw new IllegalArgumentException('PDF preview pages are unavailable. Generate the document again.');
            }

            List<Id> contentVersionIds = new List<Id>();
            for (Object rawId : rawIds) {
                Id contentVersionId = (Id) String.valueOf(rawId);
                if (contentVersionId.getSObjectType() != ContentVersion.SObjectType) {
                    throw new IllegalArgumentException('PDF preview file metadata is invalid.');
                }
                contentVersionIds.add(contentVersionId);
            }
            return contentVersionIds;
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException('PDF preview file metadata is invalid.');
        }
    }
}
