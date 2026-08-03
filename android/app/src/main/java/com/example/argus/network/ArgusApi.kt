package com.example.argus.network

import com.example.argus.data.model.*
import retrofit2.Response
import retrofit2.http.*

/**
 * Retrofit interface for the ARGUS AI Brain backend.
 */
interface ArgusApi {

    @POST("/extract-event")
    suspend fun extractEvent(
        @Header("X-Argus-Secret") secret: String,
        @Body request: ExtractRequest
    ): Response<ExtractResponse>

    @POST("/process-message")
    suspend fun processMessage(
        @Header("X-Argus-Secret") secret: String,
        @Body request: ProcessMessageRequest
    ): Response<ProcessMessageResponse>

    @GET("/health")
    suspend fun healthCheck(): Response<HealthResponse>
}
