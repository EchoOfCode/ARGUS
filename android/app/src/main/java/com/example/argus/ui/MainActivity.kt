package com.example.argus.ui

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.example.argus.ArgusApplication
import com.example.argus.data.db.NotificationEntity
import com.example.argus.theme.ArgusTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Request notification listener permission if not granted
        checkNotificationListenerPermission()
        // Request battery optimization exemption
        requestBatteryOptimization()

        setContent {
            ArgusTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    ArgusMainScreen()
                }
            }
        }
    }

    private fun checkNotificationListenerPermission() {
        val componentName = ComponentName(this, "com.example.argus.service.ArgusNotificationListener")
        val enabledListeners = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
        val isEnabled = enabledListeners?.contains(componentName.flattenToString()) == true

        if (!isEnabled) {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
    }

    private fun requestBatteryOptimization() {
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        if (!powerManager.isIgnoringBatteryOptimizations(packageName)) {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:$packageName")
            }
            startActivity(intent)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArgusMainScreen() {
    val context = LocalContext.current
    var selectedTab by remember { mutableIntStateOf(0) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("ARGUS", fontWeight = FontWeight.Bold) },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    titleContentColor = MaterialTheme.colorScheme.onPrimaryContainer
                )
            )
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    icon = { Icon(Icons.Default.Notifications, contentDescription = "Events") },
                    label = { Text("Events") },
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0 }
                )
                NavigationBarItem(
                    icon = { Icon(Icons.Default.CalendarToday, contentDescription = "Activity") },
                    label = { Text("Activity") },
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1 }
                )
                NavigationBarItem(
                    icon = { Icon(Icons.Default.Settings, contentDescription = "Settings") },
                    label = { Text("Settings") },
                    selected = selectedTab == 2,
                    onClick = { selectedTab = 2 }
                )
            }
        }
    ) { paddingValues ->
        when (selectedTab) {
            0 -> EventsTab(modifier = Modifier.padding(paddingValues))
            1 -> ActivityTab(modifier = Modifier.padding(paddingValues))
            2 -> SettingsTab(modifier = Modifier.padding(paddingValues))
        }
    }
}

@Composable
fun EventsTab(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val dao = ArgusApplication.instance.database.notificationDao()
    val notifications by dao.getAllFlow().collectAsState(initial = emptyList())

    val pendingEvents = notifications.filter {
        it.status == NotificationEntity.Status.SENT || it.status == NotificationEntity.Status.CAPTURED
    }

    if (pendingEvents.isEmpty()) {
        Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("🤖", style = MaterialTheme.typography.displayLarge)
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    "No pending events",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    "ARGUS is watching your WhatsApp messages.\nDetected events will appear here.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    } else {
        LazyColumn(
            modifier = modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(pendingEvents, key = { it.id }) { notification ->
                NotificationCard(notification)
            }
        }
    }
}

@Composable
fun NotificationCard(notification: NotificationEntity) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    notification.eventTitle ?: notification.sourceApp,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold
                )
                StatusChip(notification.status)
            }
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                notification.notificationText,
                style = MaterialTheme.typography.bodySmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (notification.eventDate != null) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    "📅 ${notification.eventDate} ${notification.eventTime ?: "(all day)"}",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium
                )
            }
            if (notification.confidence != null) {
                Text(
                    "Confidence: ${(notification.confidence * 100).toInt()}%",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
fun StatusChip(status: String) {
    val (color, label) = when (status) {
        NotificationEntity.Status.CAPTURED -> MaterialTheme.colorScheme.secondary to "Captured"
        NotificationEntity.Status.FILTERED -> MaterialTheme.colorScheme.outline to "Filtered"
        NotificationEntity.Status.SENT -> MaterialTheme.colorScheme.primary to "Pending"
        NotificationEntity.Status.CONFIRMED -> MaterialTheme.colorScheme.tertiary to "Confirmed"
        NotificationEntity.Status.IGNORED -> MaterialTheme.colorScheme.error to "Ignored"
        NotificationEntity.Status.ERROR -> MaterialTheme.colorScheme.error to "Error"
        else -> MaterialTheme.colorScheme.outline to status
    }
    AssistChip(
        onClick = {},
        label = { Text(label, style = MaterialTheme.typography.labelSmall) },
        colors = AssistChipDefaults.assistChipColors(labelColor = color)
    )
}

@Composable
fun ActivityTab(modifier: Modifier = Modifier) {
    val dao = ArgusApplication.instance.database.notificationDao()
    val notifications by dao.getAllFlow().collectAsState(initial = emptyList())

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(notifications, key = { it.id }) { notification ->
            NotificationCard(notification)
        }
    }
}

@Composable
fun SettingsTab(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var backendUrl by remember {
        mutableStateOf(
            com.example.argus.network.RetrofitClient.getBackendUrl(context)
        )
    }
    var secret by remember {
        mutableStateOf(
            com.example.argus.network.RetrofitClient.getSecret(context)
        )
    }
    var healthStatus by remember { mutableStateOf("Not checked") }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text("Backend Configuration", style = MaterialTheme.typography.titleMedium)

        OutlinedTextField(
            value = backendUrl,
            onValueChange = { backendUrl = it },
            label = { Text("Backend URL") },
            placeholder = { Text("http://100.x.x.x:8000") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )

        OutlinedTextField(
            value = secret,
            onValueChange = { secret = it },
            label = { Text("Shared Secret") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = {
                    com.example.argus.network.RetrofitClient.saveConfig(context, backendUrl, secret)
                }
            ) {
                Text("Save")
            }

            OutlinedButton(
                onClick = {
                    scope.launch {
                        try {
                            val api = com.example.argus.network.RetrofitClient.getApi(context)
                            val response = api.healthCheck()
                            healthStatus = if (response.isSuccessful) {
                                "✅ Connected — ${response.body()?.version ?: "unknown"}"
                            } else {
                                "❌ Error: ${response.code()}"
                            }
                        } catch (e: Exception) {
                            healthStatus = "❌ Unreachable: ${e.message?.take(50)}"
                        }
                    }
                }
            ) {
                Text("Test Connection")
            }
        }

        Text(
            "Status: $healthStatus",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        HorizontalDivider()

        Text("Permissions", style = MaterialTheme.typography.titleMedium)

        OutlinedButton(
            onClick = {
                context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            },
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Notification Listener Settings")
        }

        val dao = ArgusApplication.instance.database.notificationDao()
        var count by remember { mutableIntStateOf(0) }
        LaunchedEffect(Unit) {
            count = dao.count()
        }

        HorizontalDivider()

        Text("Debug", style = MaterialTheme.typography.titleMedium)
        Text(
            "Total notifications captured: $count",
            style = MaterialTheme.typography.bodyMedium
        )

        OutlinedButton(
            onClick = {
                scope.launch {
                    dao.deleteAll()
                    count = 0
                }
            },
            colors = ButtonDefaults.outlinedButtonColors(
                contentColor = MaterialTheme.colorScheme.error
            ),
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Clear All Data")
        }
    }
}
