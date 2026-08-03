package com.example.argus.data.db

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface NotificationDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(notification: NotificationEntity): Long

    @Update
    suspend fun update(notification: NotificationEntity)

    @Query("SELECT * FROM notifications ORDER BY createdAt DESC")
    fun getAllFlow(): Flow<List<NotificationEntity>>

    @Query("SELECT * FROM notifications ORDER BY createdAt DESC LIMIT :limit")
    suspend fun getRecent(limit: Int = 50): List<NotificationEntity>

    @Query("SELECT * FROM notifications WHERE id = :id")
    suspend fun getById(id: Long): NotificationEntity?

    @Query("SELECT * FROM notifications WHERE status = :status ORDER BY createdAt DESC")
    suspend fun getByStatus(status: String): List<NotificationEntity>

    @Query("UPDATE notifications SET status = :status, updatedAt = :now WHERE id = :id")
    suspend fun updateStatus(id: Long, status: String, now: Long = System.currentTimeMillis())

    @Query(
        """UPDATE notifications 
           SET status = :status, eventTitle = :title, eventDate = :date, 
               eventTime = :time, confidence = :confidence, extractionResult = :result,
               updatedAt = :now
           WHERE id = :id"""
    )
    suspend fun updateWithExtraction(
        id: Long,
        status: String,
        title: String?,
        date: String?,
        time: String?,
        confidence: Float?,
        result: String?,
        now: Long = System.currentTimeMillis()
    )

    @Query("UPDATE notifications SET replySent = 1, updatedAt = :now WHERE id = :id")
    suspend fun markReplySent(id: Long, now: Long = System.currentTimeMillis())

    @Query("DELETE FROM notifications WHERE id = :id")
    suspend fun deleteById(id: Long)

    @Query("DELETE FROM notifications")
    suspend fun deleteAll()

    @Query("SELECT COUNT(*) FROM notifications")
    suspend fun count(): Int

    @Query("SELECT COUNT(*) FROM notifications WHERE status = :status")
    suspend fun countByStatus(status: String): Int
}
