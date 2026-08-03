package com.example.argus.network

import android.content.Context
import android.content.SharedPreferences
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

/**
 * Singleton Retrofit client for the ARGUS AI Brain backend.
 *
 * The backend URL and shared secret are loaded from SharedPreferences,
 * configurable via the Settings screen.
 */
object RetrofitClient {

    private const val PREFS_NAME = "argus_prefs"
    private const val KEY_BACKEND_URL = "backend_url"
    private const val KEY_ARGUS_SECRET = "argus_secret"
    private const val DEFAULT_URL = "http://127.0.0.1:8000"

    private var retrofit: Retrofit? = null
    private var api: ArgusApi? = null

    fun getApi(context: Context): ArgusApi {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val baseUrl = prefs.getString(KEY_BACKEND_URL, DEFAULT_URL) ?: DEFAULT_URL

        // Rebuild if URL changed
        if (api == null || retrofit?.baseUrl()?.toString()?.trimEnd('/') != baseUrl.trimEnd('/')) {
            val loggingInterceptor = HttpLoggingInterceptor().apply {
                level = HttpLoggingInterceptor.Level.BODY
            }

            val client = OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS) // LLM calls can take time
                .writeTimeout(10, TimeUnit.SECONDS)
                .addInterceptor(loggingInterceptor)
                .build()

            val url = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"

            retrofit = Retrofit.Builder()
                .baseUrl(url)
                .client(client)
                .addConverterFactory(GsonConverterFactory.create())
                .build()

            api = retrofit!!.create(ArgusApi::class.java)
        }

        return api!!
    }

    fun getSecret(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_ARGUS_SECRET, "") ?: ""
    }

    fun saveConfig(context: Context, backendUrl: String, secret: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putString(KEY_BACKEND_URL, backendUrl)
            .putString(KEY_ARGUS_SECRET, secret)
            .apply()
        // Force rebuild on next getApi call
        api = null
        retrofit = null
    }

    fun getBackendUrl(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_BACKEND_URL, DEFAULT_URL) ?: DEFAULT_URL
    }
}
