export const arch_cloud = {
    title: 'Cloud resource diagram (Mermaid)',
    group: 'Architecture',
    content: `

\`\`\`mermaid
architecture-beta
    group group_alias(cloud)[Group]
    service service_alias(server)[Service] in group_alias
    service db(database)[Database] in group_alias
    service_alias:L --> R:db
\`\`\`
`,
    insert_point: 'endOfLine',
    example_content: `

\`\`\`mermaid
architecture-beta
    group pres(logos:aws-vpc)[Presentation layer]
    service dist1y(logos:aws-cloudfront)[CloudFront distribution] in pres
    dist1y{group}:R --> L:apigw{group}

    group app(logos:aws-vpc)[Application layer]
    service apigw(logos:aws-api-gateway)[API Gateway] in app
    service ecs(logos:aws-ecs)[Hosted containers] in app
    service ec2_task1(logos:aws-ec2)[Task runner] in app
    apigw:R --> L:ecs

    group db(logos:aws-rds)[RDS]
    service db1y(logos:aws-aurora)[Primary DB] in db
    service db2y(logos:aws-aurora)[Secondary DB] in db
    db1y{group}:T <-- B:ecs{group}

    group s3_pres(logos:aws-s3)[S3]
    service static_assets(logos:aws-s3)[Static assets] in s3_pres
    dist1y{group}:B --> T:static_assets{group}

    group s3_db(logos:aws-s3)[S3]
    service backup_storage(logos:aws-glacier)[Backup storage] in s3_db
    backup_storage{group}:T <-- B:db1y{group}

    group support(logos:aws-vpc)[Support]
    service ec2_bastion(logos:aws-ec2)[Bastion host] in support
    service logs(logos:aws-open-search)[Log server] in support
    ec2_bastion:L --> B:ec2_task1
\`\`\`
`,
    example_insert_point: 'endOfLine',
};

export const arch_entityrelationship = {
    title: 'Entity relationship diagram (Mermaid)',
    group: 'Architecture',
    content: `

\`\`\`mermaid
erDiagram
    ENTITY only one to zero or more ENTITY : relationship
    ENTITY {
        string attribute PK
    }
\`\`\`
`,
    insert_point: 'endOfLine',
    example_content: `

\`\`\`mermaid
erDiagram
    MAKE only one to zero or more RANGE : manufactures
    RANGE {
        string rangeName PK
    }
    RANGE ||--o{ MODEL : "composed of"
    RANGE |o--o{ RANGE : "derivative of"
    MODEL {
        string rangeName PK, FK
        string modelName PK
    }
    MODEL ||--|{ DIMENSION : "chassis"
    MODEL ||--|{ DIMENSION : "bodyshell"
    DIMENSION {
        double width
        double depth
        double height
        string unit
    }
    MODEL ||--o{ COLOUR : "available in"
    COLOUR {
        string name PK
        boolean metallic
    }
    MODEL ||--|{ DRIVETRAIN : "driven by"
    DRIVETRAIN {
        string drivetrainName PK
        string fuelType
    }
\`\`\`
`,
    example_insert_point: 'endOfLine',
};
