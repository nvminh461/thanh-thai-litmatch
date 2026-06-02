<?php
// mặc định khi cấu hình api post ở doithe1s.vn callback gọi về post json

 $txtBody = file_get_contents('php://input');
// $jsonBody = json_decode($txtBody,true); // chuyển chuỗi JSON thành một mảng

// Ở ĐÂY MÌNH CHUYỂN CHUỖI THÀNH 1 ĐỐI TƯỢNG NHÉ 
 $jsonBody = json_decode($txtBody); 

    if (isset($jsonBody->callback_sign)) 
    {
        ///Chỗ này để lưu lại LOG
        $file = @fopen('log.txt', 'a');
        if ($file)
        {
        $data =  "[" .date('Y/m/d H:i:s', time()) ."]" .file_get_contents('php://input').PHP_EOL; //lấy toàn bộ dữ liệu được gửi vào trong request
         fwrite($file, $data);
        }
        
        /// status = 1 ==> thẻ đúng
        /// status = 2 ==> thẻ sai mệnh giá
        /// status = 3 ==> thẻ lỗi
        /// status = 99 ==> thẻ chờ xử lý

        //// Kết quả trả về sẽ có các trường như sau:
        $partner_key = '9ea237ddd7c8073efc307a968ad99e04';// key của quý khách tại doithe1s
        
        //ĐỐI CHỮ KÝ, CŨNG CÓ THỂ BỎ QUA ĐỐI CHIẾU NẾU CẢM THẤY KHÔNG CẦN THIẾT 
        $callback_sign = md5($partner_key . $jsonBody->code . $jsonBody->serial);
        if ($jsonBody->callback_sign == $callback_sign) 
        {

            $getdata['status'] = $jsonBody->status; // Trạng thái thẻ
            $getdata['message'] = $jsonBody->message; // thông báo kèm theo thẻ
            $getdata['request_id'] = $jsonBody->request_id;   /// Mã giao dịch của bạn
            $getdata['trans_id'] = $jsonBody->trans_id;   /// Mã giao dịch của doithe1s.vn
            $getdata['declared_value'] = $jsonBody->declared_value;  /// Mệnh giá mà bạn khai báo 
            $getdata['value'] = $jsonBody->value;  /// Mệnh giá thực tế của thẻ
            $getdata['amount'] = $jsonBody->amount;   /// Số tiền bạn nhận về (VND)
            $getdata['code'] = $jsonBody->code;   /// Mã nạp
            $getdata['serial'] = $jsonBody->serial;  /// Serial thẻ
            $getdata['telco'] = $jsonBody->telco;   /// Nhà mạng
            print_r($getdata);
        }
        
        //KIỂM TRA STATUS VÀ XỬ LÝ CODE CỦA BẠN TẠI ĐÂY ...

    }




?>