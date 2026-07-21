package com.dinotty.mobile

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView

class MainActivity : TauriActivity() {
  // Note: the template's enableEdgeToEdge() call is intentionally removed —
  // it draws the webview underneath the system navigation bar, hiding
  // Dinotty's bottom action row (see themes.xml opt-out).

  private fun findWebView(v: View?): WebView? {
    if (v is WebView) return v
    if (v is ViewGroup) {
      for (i in 0 until v.childCount) {
        findWebView(v.getChildAt(i))?.let { return it }
      }
    }
    return null
  }

  @Deprecated("Deprecated in Java")
  override fun onBackPressed() {
    // Back walks the webview history (terminal page -> connect page) so the
    // user can switch servers; only exits the app when there is no history.
    val wv = findWebView(window.decorView.rootView)
    if (wv != null && wv.canGoBack()) {
      wv.goBack()
    } else {
      @Suppress("DEPRECATION")
      super.onBackPressed()
    }
  }
}
