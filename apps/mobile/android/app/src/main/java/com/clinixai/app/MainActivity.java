package com.clinixai.app;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.IOException;
import java.io.InputStream;
import java.util.Map;

public class MainActivity extends BridgeActivity {
    /** Serves each exported Next.js page on direct navigation instead of the SPA index fallback. */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (bridge == null) return;
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                String path = url.getPath();
                if (request.isForMainFrame() && "localhost".equals(url.getHost()) && path != null && !path.equals("/") && !path.contains(".")) {
                    String page = path.endsWith("/") ? path.substring(0, path.length() - 1) : path;
                    try (InputStream ignored = getAssets().open("public" + page + ".html")) {
                        // Delegate to Capacitor so its native bridge is still injected into the HTML.
                        Uri assetUrl = url.buildUpon().path(page + ".html").build();
                        return super.shouldInterceptRequest(view, new PageRequest(request, assetUrl));
                    } catch (IOException ignored) {
                        // Unknown routes keep Capacitor's normal fallback behavior.
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }
        });
    }

    /** Changes only the asset URL while preserving the original navigation request metadata. */
    private static final class PageRequest implements WebResourceRequest {
        private final WebResourceRequest original;
        private final Uri url;

        PageRequest(WebResourceRequest original, Uri url) {
            this.original = original;
            this.url = url;
        }
        @Override public Uri getUrl() { return url; }
        @Override public boolean isForMainFrame() { return original.isForMainFrame(); }
        @Override public boolean isRedirect() { return original.isRedirect(); }
        @Override public boolean hasGesture() { return original.hasGesture(); }
        @Override public String getMethod() { return original.getMethod(); }
        @Override public Map<String, String> getRequestHeaders() { return original.getRequestHeaders(); }
    }
}
