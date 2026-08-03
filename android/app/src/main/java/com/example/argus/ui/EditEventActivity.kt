package com.example.argus.ui

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.argus.ArgusApplication
import com.example.argus.calendar.CalendarWriter
import com.example.argus.data.db.NotificationEntity
import com.example.argus.theme.ArgusTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Edit screen for modifying event details before adding to calendar.
 * Pre-filled with extracted data, user can modify title/date/time before saving.
 */
class EditEventActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val notificationId = intent.getLongExtra(EXTRA_NOTIFICATION_ID, -1)

        setContent {
            ArgusTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    EditEventScreen(
                        notificationId = notificationId,
                        onSave = { finish() },
                        onCancel = { finish() }
                    )
                }
            }
        }
    }

    companion object {
        const val EXTRA_NOTIFICATION_ID = "notification_id"
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditEventScreen(
    notificationId: Long,
    onSave: () -> Unit,
    onCancel: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val dao = ArgusApplication.instance.database.notificationDao()

    var entity by remember { mutableStateOf<NotificationEntity?>(null) }
    var title by remember { mutableStateOf("") }
    var date by remember { mutableStateOf("") }
    var time by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(true) }

    // Load entity data
    LaunchedEffect(notificationId) {
        withContext(Dispatchers.IO) {
            entity = dao.getById(notificationId)
        }
        entity?.let {
            title = it.eventTitle ?: "Event"
            date = it.eventDate ?: ""
            time = it.eventTime ?: ""
        }
        isLoading = false
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Edit Event", fontWeight = FontWeight.Bold) },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            )
        }
    ) { paddingValues ->
        if (isLoading) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                contentAlignment = androidx.compose.ui.Alignment.Center
            ) {
                CircularProgressIndicator()
            }
        } else if (entity == null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                contentAlignment = androidx.compose.ui.Alignment.Center
            ) {
                Text("Event not found")
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // Original message
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant
                    )
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(
                            "Original message:",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            entity?.notificationText ?: "",
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }

                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("Event Title") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                OutlinedTextField(
                    value = date,
                    onValueChange = { date = it },
                    label = { Text("Date (YYYY-MM-DD)") },
                    placeholder = { Text("2026-08-05") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                OutlinedTextField(
                    value = time,
                    onValueChange = { time = it },
                    label = { Text("Time (HH:MM, 24h)") },
                    placeholder = { Text("15:00") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                Spacer(modifier = Modifier.weight(1f))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(
                        onClick = onCancel,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("Cancel")
                    }

                    Button(
                        onClick = {
                            if (title.isBlank() || date.isBlank()) {
                                Toast.makeText(context, "Title and date are required", Toast.LENGTH_SHORT).show()
                                return@Button
                            }

                            scope.launch(Dispatchers.IO) {
                                val eventId = CalendarWriter.writeEvent(
                                    context = context,
                                    title = title,
                                    date = date,
                                    time = time.ifBlank { null },
                                    description = "Added by ARGUS (edited)\n\nOriginal: ${entity?.notificationText}"
                                )

                                if (eventId != null) {
                                    dao.updateWithExtraction(
                                        id = notificationId,
                                        status = NotificationEntity.Status.CONFIRMED,
                                        title = title,
                                        date = date,
                                        time = time.ifBlank { null },
                                        confidence = entity?.confidence,
                                        result = entity?.extractionResult
                                    )
                                    withContext(Dispatchers.Main) {
                                        Toast.makeText(context, "✅ Event added to calendar!", Toast.LENGTH_SHORT).show()
                                        onSave()
                                    }
                                } else {
                                    withContext(Dispatchers.Main) {
                                        Toast.makeText(context, "⚠️ Failed to write to calendar", Toast.LENGTH_SHORT).show()
                                    }
                                }
                            }
                        },
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("Save to Calendar")
                    }
                }
            }
        }
    }
}
