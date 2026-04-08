import React, { Component, ErrorInfo, ReactNode } from "react";
import * as l10n from "@vscode/l10n";

interface ErrorBoundaryProps {
    children: ReactNode;
    onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
    has_error: boolean;
    error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {

    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { has_error: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { has_error: true, error };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error("ErrorBoundary caught an error:", error, info);
        this.props.onError?.(error, info);
    }

    handleTryAgain = (): void => {
        this.setState({ has_error: false, error: null });
    };

    render(): ReactNode {
        if (this.state.has_error && this.state.error) {
            return (
                <div
                    data-testid="error-boundary-fallback"
                    style={{
                        padding: "16px",
                        margin: "8px",
                        border: "1px solid var(--vscode-errorForeground, #f44)",
                        borderRadius: "4px",
                        backgroundColor: "var(--vscode-editor-background, #1e1e1e)",
                        color: "var(--vscode-errorForeground, #f44)",
                        fontFamily: "var(--vscode-font-family, sans-serif)",
                        fontSize: "var(--vscode-font-size, 13px)",
                    }}
                >
                    <p style={{ margin: "0 0 8px 0", fontWeight: 600 }}>
                        {l10n.t('Something went wrong rendering this view')}
                    </p>
                    <p
                        style={{
                            margin: "0 0 12px 0",
                            color: "var(--vscode-descriptionForeground, #aaa)",
                        }}
                    >
                        {this.state.error.message}
                    </p>
                    <details
                        style={{
                            marginBottom: "12px",
                            color: "var(--vscode-descriptionForeground, #aaa)",
                        }}
                    >
                        <summary style={{ cursor: "pointer" }}>{l10n.t('Stack trace')}</summary>
                        <pre
                            style={{
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                                fontSize: "12px",
                                marginTop: "8px",
                                padding: "8px",
                                backgroundColor: "var(--vscode-textCodeBlock-background, #2d2d2d)",
                                borderRadius: "2px",
                                overflow: "auto",
                                maxHeight: "300px",
                            }}
                        >
                            {this.state.error.stack}
                        </pre>
                    </details>
                    <button
                        onClick={this.handleTryAgain}
                        style={{
                            padding: "6px 14px",
                            cursor: "pointer",
                            border: "1px solid var(--vscode-button-border, transparent)",
                            borderRadius: "2px",
                            backgroundColor: "var(--vscode-button-background, #0e639c)",
                            color: "var(--vscode-button-foreground, #fff)",
                            fontFamily: "var(--vscode-font-family, sans-serif)",
                            fontSize: "var(--vscode-font-size, 13px)",
                        }}
                    >
                        {l10n.t('Try Again')}
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
