// ESP32-C3 桌面机器人控制代码
// 硬件：L298N 电机驱动模块 + 两个 N20 电机
// 功能：前进、后退、左转、右转、停止

// 定义电机驱动模块的引脚
const int IN1 = 17; // 右电机正转引脚
const int IN2 = 18; // 右电机反转引脚
const int ENA = 19; // 右电机PWM引脚

const int IN3 = 21; // 左电机正转引脚
const int IN4 = 22; // 左电机反转引脚
const int ENB = 23; // 左电机PWM引脚

// 定义电机PWM参数
const int PWM_FREQ = 30000;      // 30kHz（人耳不可闻）
const int PWM_RESOLUTION = 8;    // 8位分辨率（0-255）
const int PWM_CH_RIGHT = 0;      // 右电机PWM通道
const int PWM_CH_LEFT = 1;       // 左电机PWM通道

void setup() {
  // 初始化电机控制引脚
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(ENA, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);
  pinMode(ENB, OUTPUT);

  // 初始化PWM（左右电机独立通道，可分别调速）
  ledcSetup(PWM_CH_RIGHT, PWM_FREQ, PWM_RESOLUTION);
  ledcSetup(PWM_CH_LEFT, PWM_FREQ, PWM_RESOLUTION);
  ledcAttachPin(ENA, PWM_CH_RIGHT);
  ledcAttachPin(ENB, PWM_CH_LEFT);

  // 初始停止
  ledcWrite(PWM_CH_RIGHT, 0);
  ledcWrite(PWM_CH_LEFT, 0);

  Serial.begin(115200);
  Serial.println("桌面机器人已启动");
}

void loop() {
  // 前进 2 秒
  forward(200);
  delay(2000);
  stop();
  delay(500);

  // 后退 2 秒
  backward(200);
  delay(2000);
  stop();
  delay(500);

  // 左转 1 秒
  left(200);
  delay(1000);
  stop();
  delay(500);

  // 右转 1 秒
  right(200);
  delay(1000);
  stop();
  delay(1000);
}

// 前进：两个电机正转
void forward(int speed) {
  digitalWrite(IN1, HIGH);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, HIGH);
  digitalWrite(IN4, LOW);
  ledcWrite(PWM_CH_RIGHT, speed);
  ledcWrite(PWM_CH_LEFT, speed);
}

// 后退：两个电机反转
void backward(int speed) {
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, HIGH);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, HIGH);
  ledcWrite(PWM_CH_RIGHT, speed);
  ledcWrite(PWM_CH_LEFT, speed);
}

// 左转：右电机正转，左电机停止（差速转向）
void left(int speed) {
  digitalWrite(IN1, HIGH);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, LOW);
  ledcWrite(PWM_CH_RIGHT, speed);
  ledcWrite(PWM_CH_LEFT, 0);
}

// 右转：左电机正转，右电机停止（差速转向）
void right(int speed) {
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, HIGH);
  digitalWrite(IN4, LOW);
  ledcWrite(PWM_CH_RIGHT, 0);
  ledcWrite(PWM_CH_LEFT, speed);
}

// 停止：所有引脚拉低
void stop() {
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, LOW);
  ledcWrite(PWM_CH_RIGHT, 0);
  ledcWrite(PWM_CH_LEFT, 0);
}
