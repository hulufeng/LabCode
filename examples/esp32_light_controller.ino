/*
 * ESP32 智能关灯控制器
 * 功能：通过继电器控制灯的开关，支持物理按钮和串口命令控制
 * 硬件：ESP32 开发板 + 5V 继电器模块 + 物理按钮
 */

// ============ 引脚定义 ============
#define RELAY_PIN     26    // 继电器控制引脚（GPIO26）
#define BUTTON_PIN    27    // 物理按钮引脚（GPIO27）
#define LED_PIN       2     // 板载 LED（状态指示）

// ============ 状态变量 ============
bool lightOn = false;           // 灯的当前状态
bool lastButtonState = HIGH;    // 上一次按钮状态
unsigned long lastDebounceTime = 0;  // 上次防抖时间
unsigned long debounceDelay = 50;     // 防抖延迟（毫秒）

// ============ 初始化 ============
void setup() {
  // 初始化串口通信（波特率 115200）
  Serial.begin(115200);
  delay(100);  // 等待串口稳定

  // 设置引脚模式
  pinMode(RELAY_PIN, OUTPUT);     // 继电器引脚设为输出
  pinMode(LED_PIN, OUTPUT);       // 板载 LED 设为输出
  pinMode(BUTTON_PIN, INPUT_PULLUP);  // 按钮引脚设为上拉输入

  // 初始状态：关灯
  turnOffLight();

  // 打印启动信息
  Serial.println();
  Serial.println("========================================");
  Serial.println("  ESP32 智能关灯控制器 v1.0");
  Serial.println("========================================");
  Serial.println("继电器引脚: GPIO" + String(RELAY_PIN));
  Serial.println("按钮引脚:   GPIO" + String(BUTTON_PIN));
  Serial.println("初始状态:   关灯");
  Serial.println();
  Serial.println("可用命令:");
  Serial.println("  on   - 开灯");
  Serial.println("  off  - 关灯");
  Serial.println("  toggle - 切换状态");
  Serial.println("  status - 查询状态");
  Serial.println("========================================");
  Serial.println();
}

// ============ 主循环 ============
void loop() {
  // 1. 检测物理按钮（带防抖）
  readButton();

  // 2. 检测串口命令
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim();  // 去除首尾空白字符
    command.toLowerCase();  // 转为小写
    processCommand(command);
  }

  // 小延迟，避免 CPU 占用过高
  delay(10);
}

// ============ 开灯函数 ============
void turnOnLight() {
  digitalWrite(RELAY_PIN, HIGH);  // 继电器吸合，开灯
  digitalWrite(LED_PIN, HIGH);    // 板载 LED 亮
  lightOn = true;
  Serial.println("[状态] 💡 灯已打开");
}

// ============ 关灯函数 ============
void turnOffLight() {
  digitalWrite(RELAY_PIN, LOW);   // 继电器断开，关灯
  digitalWrite(LED_PIN, LOW);     // 板载 LED 灭
  lightOn = false;
  Serial.println("[状态] 🌑 灯已关闭");
}

// ============ 切换状态函数 ============
void toggleLight() {
  if (lightOn) {
    turnOffLight();
  } else {
    turnOnLight();
  }
}

// ============ 按钮读取（带防抖） ============
void readButton() {
  int reading = digitalRead(BUTTON_PIN);

  // 如果按钮状态改变，重置防抖计时器
  if (reading != lastButtonState) {
    lastDebounceTime = millis();
  }

  // 如果防抖时间已过，且状态确实改变了
  if ((millis() - lastDebounceTime) > debounceDelay) {
    // 按钮按下（INPUT_PULLUP 模式下，按下为 LOW）
    if (reading == LOW && lastButtonState == HIGH) {
      Serial.println("[按钮] 检测到按钮按下，切换灯状态");
      toggleLight();
    }
  }

  lastButtonState = reading;
}

// ============ 串口命令处理 ============
void processCommand(String cmd) {
  if (cmd == "on" || cmd == "open") {
    turnOnLight();
  }
  else if (cmd == "off" || cmd == "close") {
    turnOffLight();
  }
  else if (cmd == "toggle" || cmd == "switch") {
    toggleLight();
  }
  else if (cmd == "status" || cmd == "state") {
    Serial.print("[状态] 当前灯状态: ");
    if (lightOn) {
      Serial.println("💡 打开");
    } else {
      Serial.println("🌑 关闭");
    }
    Serial.print("[状态] 继电器引脚(GPIO");
    Serial.print(RELAY_PIN);
    Serial.print(") 电平: ");
    Serial.println(digitalRead(RELAY_PIN) == HIGH ? "HIGH" : "LOW");
  }
  else if (cmd == "help" || cmd == "?") {
    Serial.println("可用命令: on / off / toggle / status / help");
  }
  else if (cmd.length() > 0) {
    Serial.print("[错误] 未知命令: ");
    Serial.println(cmd);
    Serial.println("输入 'help' 查看可用命令");
  }
}
