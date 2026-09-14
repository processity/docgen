@IsTest
private class DocgenConnectionConfigTest {
    private static void assertAllControllersUse(String expected) {
        Assert.areEqual(expected, DocgenConnectionConfig.getNamedCredentialName());
        Assert.areEqual(expected, DocgenController.getNamedCredentialName());
        Assert.areEqual(expected, DocgenAsyncController.getNamedCredentialName());
        Assert.areEqual(expected, DocgenStatusController.getNamedCredentialName());
    }

    @IsTest
    static void missingSettingsUseSandboxDefault() {
        DocgenConnectionConfig.isSandbox = true;
        assertAllControllersUse('Docgen_Node_API_Sandbox');
    }

    @IsTest
    static void missingSettingsUseNonSandboxDefault() {
        DocgenConnectionConfig.isSandbox = false;
        assertAllControllersUse('Docgen_Node_API');
    }

    @IsTest
    static void blankSettingsUseSandboxDefault() {
        insert new Docgen_Settings__c(SetupOwnerId = UserInfo.getOrganizationId());
        DocgenConnectionConfig.isSandbox = true;
        assertAllControllersUse('Docgen_Node_API_Sandbox');
    }

    @IsTest
    static void whitespaceSettingsUseNonSandboxDefault() {
        insert new Docgen_Settings__c(
            SetupOwnerId = UserInfo.getOrganizationId(),
            Named_Credential_Name__c = '   '
        );
        DocgenConnectionConfig.isSandbox = false;
        assertAllControllersUse('Docgen_Node_API');
    }

    @IsTest
    static void explicitOverrideWinsInEitherOrgType() {
        insert new Docgen_Settings__c(
            SetupOwnerId = UserInfo.getOrganizationId(),
            Named_Credential_Name__c = 'Custom_Docgen_API'
        );
        DocgenConnectionConfig.isSandbox = true;
        assertAllControllersUse('Custom_Docgen_API');
        DocgenConnectionConfig.isSandbox = false;
        assertAllControllersUse('Custom_Docgen_API');
    }

    @IsTest
    static void userOverrideWinsOverOrgSetting() {
        insert new List<Docgen_Settings__c>{
            new Docgen_Settings__c(SetupOwnerId = UserInfo.getOrganizationId(),
                Named_Credential_Name__c = 'Docgen_Node_API'),
            new Docgen_Settings__c(SetupOwnerId = UserInfo.getUserId(),
                Named_Credential_Name__c = 'Custom_User_Docgen_API')
        };
        assertAllControllersUse('Custom_User_Docgen_API');
    }

    @IsTest
    static void defaultUsesActualOrganizationType() {
        Boolean sandboxOrg = [SELECT IsSandbox FROM Organization LIMIT 1].IsSandbox;
        assertAllControllersUse(sandboxOrg ? 'Docgen_Node_API_Sandbox' : 'Docgen_Node_API');
    }
}
